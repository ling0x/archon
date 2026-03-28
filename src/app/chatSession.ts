import type { ChatRecord } from '../chatStorage';
import { loadChats } from '../chatStorage';
import { setCurrentChatId } from '../session';
import type { ChatHistoryView } from '../ui/chatHistory';
import type { ConversationView } from '../ui/conversation';
import type { StatusBar } from '../ui/statusBar';
import { updateTopFormVisibility } from '../ui/threadChrome';

export type ChatSessionController = {
  applyRecord: (chat: ChatRecord) => void;
  beginNew: () => void;
  selectById: (id: string) => void;
};

const PH_NEW = 'Ask anything…';

export function createChatSessionController(deps: {
  input: HTMLInputElement;
  status: StatusBar;
  conversation: ConversationView;
  history: ChatHistoryView;
  mainEl: HTMLElement;
  onAfterNavigate?: () => void;
}): ChatSessionController {
  const { input, status, conversation, history, mainEl, onAfterNavigate } = deps;

  function applyRecord(chat: ChatRecord) {
    setCurrentChatId(chat.id);
    input.value = '';
    input.placeholder = PH_NEW;

    conversation.renderChat(chat);
    updateTopFormVisibility(mainEl);

    const last = chat.turns[chat.turns.length - 1];
    if (last?.error) {
      status.set(`Ollama error: ${last.error}`, true);
    } else {
      status.clear();
    }

    history.syncActive();
  }

  function beginNew() {
    setCurrentChatId(null);
    input.value = '';
    input.placeholder = PH_NEW;
    conversation.clear();
    conversation.hide();
    status.clear();
    history.syncActive();
    updateTopFormVisibility(mainEl);
    input.focus();
    onAfterNavigate?.();
  }

  function selectById(id: string) {
    const chat = loadChats().find((c) => c.id === id);
    if (!chat) return;
    applyRecord(chat);
    onAfterNavigate?.();
  }

  return { applyRecord, beginNew, selectById };
}
