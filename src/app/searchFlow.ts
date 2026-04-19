// =============================================================================
// Search Flow - Orchestrates the full search and answer pipeline
// =============================================================================

import type { ChatTurn, SearchFlowDeps } from '../types';
import { getChatById } from '../chatStorage';
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
  OLLAMA_ANSWER_NUM_CTX,
  OLLAMA_DEEP_ANSWER_NUM_CTX,
} from '../services/ollama';
import { mergeRankedSearchResultLists, searchSearXNGMulti } from '../searxng';
import { getCurrentChatId, setCurrentChatId } from '../session';
import { getSelectedModel } from '../modelPicker';
import { defaultThinkParameter, modelSupportsThinking } from '../modelCapabilities';
import { setComposerBusyState, updateTopFormVisibility } from '../ui/threadChrome';
import { createTurn, appendTurnToChat, createNewChatWithTurn } from '../chatStorage';

// Build-time config
const DEEP_ANSWER_MODEL_OVERRIDE = __OLLAMA_DEEP_ANSWER_MODEL__;

// Search parameters
const SHALLOW = { perQuery: __ARCHON_SHALLOW_PER_QUERY__, maxTotal: __ARCHON_SHALLOW_MAX_TOTAL__, maxRounds: __ARCHON_SHALLOW_MAX_ROUNDS__ };
const DEEP = { perQuery: __ARCHON_DEEP_PER_QUERY__, maxTotal: __ARCHON_DEEP_MAX_TOTAL__, maxRounds: __ARCHON_DEEP_MAX_ROUNDS__ };
const EXTRACT_MAX_URLS = __ARCHON_EXTRACT_MAX_URLS__;

// Placeholders
const PLACEHOLDER_FOLLOW = 'Ask a follow-up…';
const MAX_QUERY_STATUS_LEN = 320;

// =============================================================================
// Helpers
// =============================================================================

function getPriorTurns(threadId: string | null) {
  if (!threadId) return [];
  const chat = getChatById(threadId);
  if (!chat) return [];
  return chat.turns.map((t) => ({ query: t.query, answer: t.answerRaw }));
}

function formatQueryForStatus(q: string): string {
  const oneLine = q.trim().replace(/\s+/g, ' ');
  if (!oneLine) return '(empty query)';
  return oneLine.length > MAX_QUERY_STATUS_LEN
    ? `${oneLine.slice(0, MAX_QUERY_STATUS_LEN - 1)}…`
    : oneLine;
}

function formatQueryStatusBlock(queries: readonly string[]): string {
  if (queries.length === 1) {
    return `Query: ${formatQueryForStatus(queries[0])}`;
  }
  return `Queries (${queries.length}):\n${queries
    .map((q, i) => `${i + 1}. ${formatQueryForStatus(q)}`)
    .join('\n')}`;
}

function resolveAnswerModel(selected: string, deep: boolean): string {
  const override = DEEP_ANSWER_MODEL_OVERRIDE.trim();
  if (deep && override.length > 0) return override;
  return selected;
}

function commitTurn(
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

// =============================================================================
// Main Search Flow
// =============================================================================

export async function runSearch(query: string, deps: SearchFlowDeps): Promise<void> {
  const { status, statusSlot, conversation, history, input, mainEl, modelSelect, deepResearch } = deps;

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
  const priorTurns = getPriorTurns(isFollowUp ? threadId : null);

  const params = deepResearch ? DEEP : SHALLOW;
  const formulationThinkingCapable = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  turnUi.setFormulationMeta(SEARCH_FORMULATION_MODEL, formulationThinkingCapable);

  // ---------------------------------------------------------------------------
  // Step 1: Formulate search queries
  // ---------------------------------------------------------------------------
  setComposerBusyState(mainEl, 'formulating');
  status.set(deepResearch
    ? `Deep research: planning & queries (${SEARCH_FORMULATION_MODEL})…`
    : `Formulating search queries (${SEARCH_FORMULATION_MODEL})…`
  );

  let searchQueries: string[] = [query];
  let researchPlan: string[] | undefined;
  let formulationPreview = '';
  let formulationThinkingRaw = '';

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
          const compact = formulationPreview.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_STATUS_LEN);
          status.set(`Deep research: planning…\nDraft: ${compact}`);
        },
      });
      researchPlan = planResult.plan.length > 0 ? planResult.plan : undefined;
      if (researchPlan) turnUi.setResearchPlan(researchPlan);
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
          const compact = formulationPreview.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_STATUS_LEN);
          status.set(`Formulating search queries (${SEARCH_FORMULATION_MODEL})…\nDraft: ${compact}`);
        },
      });
    }
  } catch {
    searchQueries = [query];
  }

  if (searchQueries.length === 0) searchQueries = [query];
  turnUi.setFormulationQueries(searchQueries);

  // ---------------------------------------------------------------------------
  // Step 2: Search
  // ---------------------------------------------------------------------------
  setComposerBusyState(mainEl, 'searching');
  status.set(`Searching the web via SearXNG…\n${formatQueryStatusBlock(searchQueries)}`);

  let results = await searchSearXNGMulti(searchQueries, {
    perQuery: params.perQuery,
    maxTotal: params.maxTotal,
  });

  // Deep research: follow-up search if needed
  if (deepResearch && params.maxRounds >= 2 && results.length > 0) {
    status.set(`Analyzing coverage for follow-up search…\n${formatQueryStatusBlock(searchQueries)}`);
    const brief = buildBriefSearchSummaryForGap(results);
    const gap = await analyzeSearchGaps(query, priorTurns, brief);

    if (!gap.sufficient && gap.followUpQueries.length > 0) {
      status.set(`Follow-up search (${gap.followUpQueries.length} query${gap.followUpQueries.length === 1 ? '' : 'ies'})…`);
      const round2 = await searchSearXNGMulti(gap.followUpQueries, {
        perQuery: params.perQuery,
        maxTotal: params.maxTotal,
      });
      searchQueries = [...searchQueries, ...gap.followUpQueries];
      results = mergeRankedSearchResultLists([results, round2], params.maxTotal);
    }
  }

  const searchQueriesNote = searchQueries.join(' · ');

  if (results.length === 0) {
    status.set(`No search results found for:\n${formatQueryStatusBlock(searchQueries)}\nAnswering in no-web-results mode…`);
  } else {
    status.set(`Found ${results.length} unique result${results.length === 1 ? '' : 's'}\n${formatQueryStatusBlock(searchQueries)}\nGenerating answer…`);
  }

  turnUi.setSources(results);

  // ---------------------------------------------------------------------------
  // Step 3: Extract full page text (deep research only)
  // ---------------------------------------------------------------------------
  let extracted: Map<string, string> | undefined;
  if (deepResearch && EXTRACT_MAX_URLS > 0 && results.length > 0) {
    status.set(`Fetching full-page text (up to ${EXTRACT_MAX_URLS} URLs)…\n${formatQueryStatusBlock(searchQueries)}`);
    const urls = results.slice(0, EXTRACT_MAX_URLS).map((r) => r.url.trim()).filter(Boolean);
    extracted = await fetchExtractedTexts(urls);
    if (extracted.size > 0) {
      status.set(`Extracted text from ${extracted.size} page${extracted.size === 1 ? '' : 's'}. Generating…\n${formatQueryStatusBlock(searchQueries)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4: Generate answer
  // ---------------------------------------------------------------------------
  let answerRaw = '';
  let thinkingRaw = '';
  let researchNotesRaw: string | undefined;
  setComposerBusyState(mainEl, 'thinking');

  const genStart = performance.now();

  const buildTurn = (generationMs: number, errorMsg?: string) => createTurn({
    query,
    answerRaw,
    thinkingRaw: thinkingRaw.trim() || undefined,
    ...(thinkingCapable ? { thinkingCapable: true as const } : {}),
    formulationModel: SEARCH_FORMULATION_MODEL,
    ...(formulationThinkingCapable ? { formulationThinkingCapable: true as const } : {}),
    ...(formulationThinkingRaw.trim() ? { formulationThinkingRaw: formulationThinkingRaw.trim() } : {}),
    ...(searchQueries.length > 0 ? { formulationQueries: [...searchQueries] } : {}),
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
      // Two-pass synthesis
      status.set(`Deep research: drafting notes (pass 1)…\n${formatQueryStatusBlock(searchQueries)}`);
      researchNotesRaw = '';

      for await (const chunk of streamOllamaResearchNotes(query, context, priorTurns, model, { think, deepResearch: true })) {
        if (chunk.kind === 'thinking') {
          thinkingRaw += chunk.text;
          turnUi.appendThinkingChunk(chunk.text);
        } else {
          researchNotesRaw += chunk.text;
        }
      }

      status.set(`Deep research: writing final answer (pass 2)…\n${formatQueryStatusBlock(searchQueries)}`);

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
      // Single-pass answer
      for await (const chunk of streamOllamaAnswer(query, context, priorTurns, model, {
        searchQueryUsed: searchQueriesNote,
        hasSearchResults: results.length > 0,
        think,
        deepResearch,
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
    commitTurn(buildTurn(generationMs), isFollowUp, threadId, { conversation, history, mainEl });

  } catch (err) {
    const msg = (err as Error).message;
    status.set(`Ollama error: ${msg}`, true);
    const generationMs = Math.max(0, Math.round(performance.now() - genStart));
    commitTurn(buildTurn(generationMs, msg), isFollowUp, threadId, { conversation, history, mainEl });

  } finally {
    setComposerBusyState(mainEl, 'idle');
    if (getCurrentChatId()) {
      input.placeholder = PLACEHOLDER_FOLLOW;
    }
    mainEl
      .querySelectorAll<HTMLTextAreaElement>('.turn-followup-input:not([disabled]):not(.is-followup-inactive)')
      .forEach((inp) => { inp.placeholder = PLACEHOLDER_FOLLOW; });
    requestAnimationFrame(() => {
      mainEl
        .querySelector<HTMLTextAreaElement>('.turn-followup-input:not([disabled]):not(.is-followup-inactive)')
        ?.focus();
    });
  }
}