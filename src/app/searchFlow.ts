import {
  appendTurnToChat,
  createNewChatWithTurn,
  createTurn,
  getChatById,
} from '../chatStorage';
import { buildSearchContext } from '../context/buildSearchContext';
import {
  formulateSearchQuery,
  streamOllamaAnswer,
  type PriorTurn,
} from '../ollama';
import { searchSearXNG, type SearchResult } from '../searxng';
import { getCurrentChatId, setCurrentChatId } from '../session';
import type { ChatHistoryView } from '../ui/chatHistory';
import type { ConversationView } from '../ui/conversation';
import type { StatusBar } from '../ui/statusBar';
import { getSelectedModel } from '../modelPicker';
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

  const turnUi = conversation.startTurn(query, model);

  const priorTurns = priorTurnsForPrompt(isFollowUp ? threadId : null);

  let searchQuery = query;
  if (isFollowUp && priorTurns.length > 0) {
    setComposerBusyState(mainEl, 'formulating');
    status.set('Formulating search query from conversation…');
    try {
      searchQuery = await formulateSearchQuery(query, priorTurns, model);
    } catch {
      searchQuery = query;
    }
  }

  setComposerBusyState(mainEl, 'searching');

  const qStatus = formatSearchQueryForStatus(searchQuery);
  let results: SearchResult[] = [];

  try {
    status.set(
      `Searching the web via SearXNG…\nQuery: ${qStatus}`,
    );
    results = await searchSearXNG(searchQuery);

    if (results.length === 0) {
      status.set(
        `No search results found for:\n${qStatus}\nAsking Ollama anyway…`,
      );
    } else {
      status.set(
        `Found ${results.length} result${results.length === 1 ? '' : 's'} for:\n${qStatus}\nGenerating answer…`,
      );
    }
  } catch (err) {
    status.set(
      `Search failed for:\n${qStatus}\n${(err as Error).message}\nAttempting to answer without search results…`,
      true,
    );
  }

  turnUi.setSources(results);

  let answerRaw = '';
  setComposerBusyState(mainEl, 'thinking');

  try {
    const context = buildSearchContext(results);
    for await (const token of streamOllamaAnswer(
      query,
      context,
      priorTurns,
      model,
      isFollowUp ? { searchQueryUsed: searchQuery } : undefined,
    )) {
      answerRaw += token;
      turnUi.setAnswerMarkdown(answerRaw);
    }
    status.clear();

    const turn = createTurn({ query, answerRaw, sources: results, model });
    if (isFollowUp) {
      appendTurnToChat(threadId!, turn);
    } else {
      const chat = createNewChatWithTurn(turn);
      setCurrentChatId(chat.id);
    }
    history.render();
    history.syncActive();

    const id = getCurrentChatId()!;
    const chat = getChatById(id);
    if (chat) {
      conversation.renderChat(chat);
      updateTopFormVisibility(mainEl);
    }
  } catch (err) {
    const msg = (err as Error).message;
    status.set(`Ollama error: ${msg}`, true);

    const turn = createTurn({
      query,
      answerRaw,
      sources: results,
      model,
      error: msg,
    });
    if (isFollowUp) {
      appendTurnToChat(threadId!, turn);
    } else {
      const chat = createNewChatWithTurn(turn);
      setCurrentChatId(chat.id);
    }
    history.render();
    history.syncActive();

    const id = getCurrentChatId()!;
    const chat = getChatById(id);
    if (chat) {
      conversation.renderChat(chat);
      updateTopFormVisibility(mainEl);
    }
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
