// =============================================================================
// Chat Session Controller
// =============================================================================

import type { ChatRecord } from '../types';
import type { ChatSessionController } from '../types';
import { loadChats, getChatById } from '../chatStorage';
import { setCurrentChatId } from '../session';
import type { ChatHistoryView, ConversationView, StatusBar } from '../types';
import { statusSlotAtConversationTail } from '../ui/statusBar';
import { updateTopFormVisibility } from '../ui/threadChrome';

const PLACEHOLDER_NEW = 'Ask anything…';

export function createChatSessionController(deps: {
  input: HTMLTextAreaElement;
  status: StatusBar;
  mainStatusSlot: HTMLElement;
  conversation: ConversationView;
  history: ChatHistoryView;
  mainEl: HTMLElement;
  onAfterNavigate?: () => void;
}): ChatSessionController {
  const { input, status, mainStatusSlot, conversation, history, mainEl, onAfterNavigate } = deps;

  function applyRecord(chat: ChatRecord): void {
    setCurrentChatId(chat.id);
    input.value = '';
    input.placeholder = PLACEHOLDER_NEW;
    conversation.renderChat(chat);
    updateTopFormVisibility(mainEl);
    status.setTarget(statusSlotAtConversationTail(mainEl, mainStatusSlot));

    const last = chat.turns[chat.turns.length - 1];
    if (last?.error) {
      status.set(`Ollama error: ${last.error}`, true);
    } else {
      status.clear();
    }
    history.syncActive();
  }

  function beginNew(): void {
    setCurrentChatId(null);
    input.value = '';
    input.placeholder = PLACEHOLDER_NEW;
    conversation.clear();
    conversation.hide();
    status.clearAll();
    history.syncActive();
    updateTopFormVisibility(mainEl);
    input.focus();
    onAfterNavigate?.();
  }

  function selectById(id: string): void {
    const chat = loadChats().find((c) => c.id === id);
    if (!chat) return;
    applyRecord(chat);
    onAfterNavigate?.();
  }

  return { applyRecord, beginNew, selectById };
}