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
  conversation: ConversationView;
  history: ChatHistoryView;
  input: HTMLInputElement;
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

export async function runSearch(query: string, deps: SearchFlowDeps): Promise<void> {
  const { status, conversation, history, input, mainEl, modelSelect } = deps;

  const model = getSelectedModel(modelSelect);

  const threadId = getCurrentChatId();
  const isFollowUp = threadId !== null;

  if (!isFollowUp) {
    conversation.clear();
  }

  const turnUi = conversation.startTurn(query);

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

  let results: SearchResult[] = [];

  try {
    status.set('Searching the web via SearXNG…');
    results = await searchSearXNG(searchQuery);

    if (results.length === 0) {
      status.set('No search results found. Asking Ollama anyway…');
    } else {
      status.set(`Found ${results.length} results. Generating answer…`);
    }
  } catch (err) {
    status.set(
      `Search failed: ${(err as Error).message}. Attempting to answer without search results…`,
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

    const turn = createTurn({ query, answerRaw, sources: results });
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
      .querySelectorAll<HTMLInputElement>(
        '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
      )
      .forEach((inp) => {
        inp.placeholder = PLACEHOLDER_FOLLOW;
      });
    requestAnimationFrame(() => {
      mainEl
        .querySelector<HTMLInputElement>(
          '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
        )
        ?.focus();
    });
  }
}
