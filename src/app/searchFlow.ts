import {
  appendTurnToChat,
  createNewChatWithTurn,
  createTurn,
  getChatById,
  type ChatTurn,
} from '../chatStorage';
import { buildSearchContext } from '../context/buildSearchContext';
import {
  formulateSearchQueries,
  SEARCH_FORMULATION_MODEL,
  streamOllamaAnswer,
  type PriorTurn,
} from '../ollama';
import { searchSearXNGMulti, type SearchResult } from '../searxng';
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

export type SearchFlowDeps = {
  status: StatusBar;
  /** Composer status line to use for this run (main or the submitting follow-up strip). */
  statusSlot: HTMLElement;
  conversation: ConversationView;
  history: ChatHistoryView;
  input: HTMLTextAreaElement;
  mainEl: HTMLElement;
  modelSelect: HTMLSelectElement;
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

export async function runSearch(query: string, deps: SearchFlowDeps): Promise<void> {
  const { status, statusSlot, conversation, history, input, mainEl, modelSelect } =
    deps;

  status.setTarget(statusSlot);

  const model = getSelectedModel(modelSelect);

  const threadId = getCurrentChatId();
  const isFollowUp = threadId !== null;

  if (!isFollowUp) {
    conversation.clear();
  }

  const thinkingCapable = await modelSupportsThinking(model);
  const turnUi = conversation.startTurn(query, model, { thinkingCapable });

  const priorTurns = priorTurnsForPrompt(isFollowUp ? threadId : null);

  setComposerBusyState(mainEl, 'formulating');
  status.set(`Formulating search queries (${SEARCH_FORMULATION_MODEL})…`);

  let searchQueries: string[] = [query];
  let formulationPreview = '';
  let formulationThinkingRaw = '';
  const formulationThinkingCapable = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  turnUi.setFormulationMeta(SEARCH_FORMULATION_MODEL, formulationThinkingCapable);
  try {
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
  } catch {
    searchQueries = [query];
  }
  if (searchQueries.length === 0) {
    searchQueries = [query];
  }
  turnUi.setFormulationQueries(searchQueries);

  setComposerBusyState(mainEl, 'searching');

  const qStatusBlock = formatMultiQueryStatusBlock(searchQueries);
  const searchQueriesNote = searchQueries.join(' · ');

  status.set(`Searching the web via SearXNG…\n${qStatusBlock}`);
  const results = await searchSearXNGMulti(searchQueries, {
    perQuery: 8,
    maxTotal: 16,
  });

  if (results.length === 0) {
    status.set(
      `No search results found for:\n${qStatusBlock}\nAnswering in no-web-results mode…`,
    );
  } else {
    status.set(
      `Found ${results.length} unique result${results.length === 1 ? '' : 's'} (merged from ${searchQueries.length} search${searchQueries.length === 1 ? '' : 'es'})\n${qStatusBlock}\nGenerating answer…`,
    );
  }

  turnUi.setSources(results);

  let answerRaw = '';
  let thinkingRaw = '';
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
      ...(searchQueries.length > 0 ? { formulationQueries: [...searchQueries] } : {}),
      sources: results,
      model,
      generationMs,
      ...(errorMsg ? { error: errorMsg } : {}),
    });

  try {
    const context = buildSearchContext(results);
    const think = thinkingCapable ? defaultThinkParameter(model) : undefined;

    for await (const chunk of streamOllamaAnswer(
      query,
      context,
      priorTurns,
      model,
      {
        searchQueryUsed: searchQueriesNote,
        hasSearchResults: results.length > 0,
        think,
      },
    )) {
      if (chunk.kind === 'thinking') {
        thinkingRaw += chunk.text;
        turnUi.appendThinkingChunk(chunk.text);
      } else {
        answerRaw += chunk.text;
        turnUi.setAnswerMarkdown(answerRaw);
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
