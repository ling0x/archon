import {
  appendTurnToChat,
  createNewChatWithTurn,
  createTurn,
  getChatById,
  type ChatTurn,
} from '../chatStorage';
import { buildSearchContext } from '../context/buildSearchContext';
import { fetchExtractedTexts } from '../api/fetchExtractedPages';
import { buildBriefSearchSummaryForGap } from '../research/briefSearchSummary';
import {
  analyzeSearchGaps,
  formulateDeepResearchPlanAndQueries,
  formulateSearchQueries,
  SEARCH_FORMULATION_MODEL,
  streamOllamaAnswer,
  streamOllamaResearchNotes,
  type PriorTurn,
} from '../ollama';
import { mergeRankedSearchResultLists, searchSearXNGMulti } from '../searxng';
import { getCurrentChatId, setCurrentChatId } from '../session';
import type { ChatHistoryView } from '../ui/chatHistory';
import type { ConversationView } from '../ui/conversation';
import type { StatusBar } from '../ui/statusBar';
import { getSelectedModel } from '../modelPicker';
import { defaultThinkParameter, modelSupportsThinking } from '../modelCapabilities';
import {
  setComposerBusyState,
  updateTopFormVisibility,
} from '../ui/threadChrome';

const SHALLOW_PER_QUERY: number = __ARCHON_SHALLOW_PER_QUERY__;
const SHALLOW_MAX_TOTAL: number = __ARCHON_SHALLOW_MAX_TOTAL__;
const SHALLOW_MAX_ROUNDS: number = __ARCHON_SHALLOW_MAX_ROUNDS__;
const DEEP_PER_QUERY: number = __ARCHON_DEEP_PER_QUERY__;
const DEEP_MAX_TOTAL: number = __ARCHON_DEEP_MAX_TOTAL__;
const DEEP_MAX_ROUNDS: number = __ARCHON_DEEP_MAX_ROUNDS__;
const EXTRACT_MAX_URLS: number = __ARCHON_EXTRACT_MAX_URLS__;
const DEEP_ANSWER_MODEL_OVERRIDE: string = __OLLAMA_DEEP_ANSWER_MODEL__;

export type SearchFlowDeps = {
  status: StatusBar;
  /** Composer status line to use for this run (main or the submitting follow-up strip). */
  statusSlot: HTMLElement;
  conversation: ConversationView;
  history: ChatHistoryView;
  input: HTMLTextAreaElement;
  mainEl: HTMLElement;
  modelSelect: HTMLSelectElement;
  /** Main + follow-up forms: deep research mode (multi-round search, extraction, two-pass answer). */
  deepResearch: boolean;
};

function priorTurnsForPrompt(chatId: string | null): PriorTurn[] {
  if (!chatId) return [];
  const chat = getChatById(chatId);
  if (!chat) return [];
  return chat.turns.map((t) => ({
    query: t.query,
    answer: t.answerRaw,
  }));
}

const PLACEHOLDER_FOLLOW = 'Ask a follow-up…';

const MAX_QUERY_STATUS_LEN = 320;

/** Single-line, length-capped query text for status under the composer. */
function formatSearchQueryForStatus(q: string): string {
  const oneLine = q.trim().replace(/\s+/g, ' ');
  if (!oneLine) return '(empty query)';
  return oneLine.length > MAX_QUERY_STATUS_LEN
    ? `${oneLine.slice(0, MAX_QUERY_STATUS_LEN - 1)}…`
    : oneLine;
}

function formatMultiQueryStatusBlock(queries: readonly string[]): string {
  if (queries.length === 1) {
    return `Query: ${formatSearchQueryForStatus(queries[0])}`;
  }
  return `Queries (${queries.length}):\n${queries
    .map((q, i) => `${i + 1}. ${formatSearchQueryForStatus(q)}`)
    .join('\n')}`;
}

function commitTurnAndRefreshUi(
  turn: ChatTurn,
  isFollowUp: boolean,
  threadId: string | null,
  deps: Pick<SearchFlowDeps, 'conversation' | 'history' | 'mainEl'>,
): void {
  if (isFollowUp) {
    appendTurnToChat(threadId!, turn);
  } else {
    const chat = createNewChatWithTurn(turn);
    setCurrentChatId(chat.id);
  }
  deps.history.render();
  deps.history.syncActive();
  const id = getCurrentChatId();
  if (!id) return;
  const chat = getChatById(id);
  if (chat) {
    deps.conversation.renderChat(chat);
    updateTopFormVisibility(deps.mainEl);
  }
}

function resolveAnswerModel(selected: string, deep: boolean): string {
  const o = DEEP_ANSWER_MODEL_OVERRIDE.trim();
  if (deep && o.length > 0) return o;
  return selected;
}

export async function runSearch(query: string, deps: SearchFlowDeps): Promise<void> {
  const {
    status,
    statusSlot,
    conversation,
    history,
    input,
    mainEl,
    modelSelect,
    deepResearch,
  } = deps;

  status.setTarget(statusSlot);

  const selectedModel = getSelectedModel(modelSelect);
  const model = resolveAnswerModel(selectedModel, deepResearch);

  const threadId = getCurrentChatId();
  const isFollowUp = threadId !== null;

  if (!isFollowUp) {
    conversation.clear();
  }

  const thinkingCapable = await modelSupportsThinking(model);
  const turnUi = conversation.startTurn(query, model, { thinkingCapable });

  const priorTurns = priorTurnsForPrompt(isFollowUp ? threadId : null);

  const perQ = deepResearch ? DEEP_PER_QUERY : SHALLOW_PER_QUERY;
  const maxTotal = deepResearch ? DEEP_MAX_TOTAL : SHALLOW_MAX_TOTAL;
  const maxRounds = deepResearch ? DEEP_MAX_ROUNDS : SHALLOW_MAX_ROUNDS;

  setComposerBusyState(mainEl, 'formulating');
  status.set(
    deepResearch
      ? `Deep research: planning & queries (${SEARCH_FORMULATION_MODEL})…`
      : `Formulating search queries (${SEARCH_FORMULATION_MODEL})…`,
  );

  let searchQueries: string[] = [query];
  let researchPlan: string[] | undefined;
  let formulationPreview = '';
  let formulationThinkingRaw = '';
  const formulationThinkingCapable = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  turnUi.setFormulationMeta(SEARCH_FORMULATION_MODEL, formulationThinkingCapable);

  try {
    if (deepResearch) {
      const planResult = await formulateDeepResearchPlanAndQueries(query, priorTurns, {
        onThinkingChunk: (text) => {
          if (!text.trim()) return;
          formulationThinkingRaw += text;
          turnUi.appendFormulationThinkingChunk(text);
        },
        onResponseChunk: (text) => {
          formulationPreview += text;
          const compact = formulationPreview.trim().replace(/\s+/g, ' ');
          if (!compact) return;
          const shown =
            compact.length > MAX_QUERY_STATUS_LEN
              ? `${compact.slice(0, MAX_QUERY_STATUS_LEN - 1)}…`
              : compact;
          status.set(`Deep research: planning…\nDraft: ${shown}`);
        },
      });
      researchPlan = planResult.plan.length > 0 ? planResult.plan : undefined;
      if (researchPlan) {
        turnUi.setResearchPlan(researchPlan);
      }
      searchQueries = planResult.queries;
    } else {
      searchQueries = await formulateSearchQueries(query, priorTurns, {
        onThinkingChunk: (text) => {
          if (!text.trim()) return;
          formulationThinkingRaw += text;
          turnUi.appendFormulationThinkingChunk(text);
        },
        onResponseChunk: (text) => {
          formulationPreview += text;
          const compact = formulationPreview.trim().replace(/\s+/g, ' ');
          if (!compact) return;
          const shown =
            compact.length > MAX_QUERY_STATUS_LEN
              ? `${compact.slice(0, MAX_QUERY_STATUS_LEN - 1)}…`
              : compact;
          status.set(
            `Formulating search queries (${SEARCH_FORMULATION_MODEL})…\nDraft: ${shown}`,
          );
        },
      });
    }
  } catch {
    searchQueries = [query];
  }
  if (searchQueries.length === 0) {
    searchQueries = [query];
  }
  turnUi.setFormulationQueries(searchQueries);

  setComposerBusyState(mainEl, 'searching');

  let allQueryLabels = [...searchQueries];
  const qStatusBlock = formatMultiQueryStatusBlock(searchQueries);
  status.set(`Searching the web via SearXNG…\n${qStatusBlock}`);

  let results = await searchSearXNGMulti(searchQueries, {
    perQuery: perQ,
    maxTotal,
  });

  if (deepResearch && maxRounds >= 2 && results.length > 0) {
    status.set(`Analyzing coverage for follow-up search…\n${formatMultiQueryStatusBlock(allQueryLabels)}`);
    const brief = buildBriefSearchSummaryForGap(results);
    const gap = await analyzeSearchGaps(query, priorTurns, brief);
    if (!gap.sufficient && gap.followUpQueries.length > 0) {
      status.set(
        `Follow-up search (${gap.followUpQueries.length} quer${gap.followUpQueries.length === 1 ? 'y' : 'ies'})…`,
      );
      const round2 = await searchSearXNGMulti(gap.followUpQueries, {
        perQuery: perQ,
        maxTotal,
      });
      allQueryLabels = [...allQueryLabels, ...gap.followUpQueries];
      results = mergeRankedSearchResultLists([results, round2], maxTotal);
    }
  }

  const searchQueriesNote = allQueryLabels.join(' · ');
  const qFinalBlock = formatMultiQueryStatusBlock(allQueryLabels);

  if (results.length === 0) {
    status.set(
      `No search results found for:\n${qFinalBlock}\nAnswering in no-web-results mode…`,
    );
  } else {
    status.set(
      `Found ${results.length} unique result${results.length === 1 ? '' : 's'}\n${qFinalBlock}\nGenerating answer…`,
    );
  }

  turnUi.setSources(results);

  let extracted: Map<string, string> | undefined;
  if (deepResearch && EXTRACT_MAX_URLS > 0 && results.length > 0) {
    status.set(`Fetching full-page text (up to ${EXTRACT_MAX_URLS} URLs)…\n${qFinalBlock}`);
    const urls = results.slice(0, EXTRACT_MAX_URLS).map((r) => r.url.trim()).filter(Boolean);
    extracted = await fetchExtractedTexts(urls);
    if (extracted.size > 0) {
      status.set(
        `Extracted text from ${extracted.size} page${extracted.size === 1 ? '' : 's'}. Generating…\n${qFinalBlock}`,
      );
    }
  }

  let answerRaw = '';
  let thinkingRaw = '';
  let researchNotesRaw: string | undefined;
  setComposerBusyState(mainEl, 'thinking');

  const genStart = performance.now();
  const buildTurn = (generationMs: number, errorMsg?: string) =>
    createTurn({
      query,
      answerRaw,
      thinkingRaw: thinkingRaw.trim() || undefined,
      ...(thinkingCapable ? { thinkingCapable: true as const } : {}),
      formulationModel: SEARCH_FORMULATION_MODEL,
      ...(formulationThinkingCapable
        ? { formulationThinkingCapable: true as const }
        : {}),
      ...(formulationThinkingRaw.trim()
        ? { formulationThinkingRaw: formulationThinkingRaw.trim() }
        : {}),
      ...(allQueryLabels.length > 0 ? { formulationQueries: [...allQueryLabels] } : {}),
      ...(researchPlan ? { researchPlan: [...researchPlan] } : {}),
      ...(researchNotesRaw?.trim() ? { researchNotesRaw: researchNotesRaw.trim() } : {}),
      ...(deepResearch ? { deepResearch: true as const } : {}),
      sources: results,
      model,
      generationMs,
      ...(errorMsg ? { error: errorMsg } : {}),
    });

  try {
    const context = buildSearchContext(results, extracted);

    const think = thinkingCapable ? defaultThinkParameter(model) : undefined;
    const useTwoPass = deepResearch && results.length > 0;

    if (useTwoPass) {
      status.set(`Deep research: drafting notes (pass 1)…\n${qFinalBlock}`);
      researchNotesRaw = '';
      for await (const chunk of streamOllamaResearchNotes(
        query,
        context,
        priorTurns,
        model,
        { think, deepResearch: true },
      )) {
        if (chunk.kind === 'thinking') {
          thinkingRaw += chunk.text;
          turnUi.appendThinkingChunk(chunk.text);
        } else {
          researchNotesRaw += chunk.text;
        }
      }

      status.set(`Deep research: writing final answer (pass 2)…\n${qFinalBlock}`);
      for await (const chunk of streamOllamaAnswer(query, context, priorTurns, model, {
        searchQueryUsed: searchQueriesNote,
        hasSearchResults: true,
        think,
        deepResearch: true,
        intermediateResearchNotes: researchNotesRaw,
        twoPassSynthesis: true,
      })) {
        if (chunk.kind === 'thinking') {
          thinkingRaw += chunk.text;
          turnUi.appendThinkingChunk(chunk.text);
        } else {
          answerRaw += chunk.text;
          turnUi.setAnswerMarkdown(answerRaw);
        }
      }
    } else {
      for await (const chunk of streamOllamaAnswer(query, context, priorTurns, model, {
        searchQueryUsed: searchQueriesNote,
        hasSearchResults: results.length > 0,
        think,
        deepResearch: deepResearch,
      })) {
        if (chunk.kind === 'thinking') {
          thinkingRaw += chunk.text;
          turnUi.appendThinkingChunk(chunk.text);
        } else {
          answerRaw += chunk.text;
          turnUi.setAnswerMarkdown(answerRaw);
        }
      }
    }

    status.clear();

    const generationMs = Math.max(0, Math.round(performance.now() - genStart));
    commitTurnAndRefreshUi(buildTurn(generationMs), isFollowUp, threadId, {
      conversation,
      history,
      mainEl,
    });
  } catch (err) {
    const msg = (err as Error).message;
    status.set(`Ollama error: ${msg}`, true);

    const generationMs = Math.max(0, Math.round(performance.now() - genStart));
    commitTurnAndRefreshUi(buildTurn(generationMs, msg), isFollowUp, threadId, {
      conversation,
      history,
      mainEl,
    });
  } finally {
    setComposerBusyState(mainEl, 'idle');
    if (getCurrentChatId()) {
      input.placeholder = PLACEHOLDER_FOLLOW;
    }
    mainEl
      .querySelectorAll<HTMLTextAreaElement>(
        '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
      )
      .forEach((inp) => {
        inp.placeholder = PLACEHOLDER_FOLLOW;
      });
    requestAnimationFrame(() => {
      mainEl
        .querySelector<HTMLTextAreaElement>(
          '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
        )
        ?.focus();
    });
  }
}
