import type { ChatRecord } from '../chatStorage';
import { loadChats } from '../chatStorage';
import { setCurrentChatId } from '../session';
import type { AnswerPanel } from '../ui/answerPanel';
import type { ChatHistoryView } from '../ui/chatHistory';
import type { SourcesList } from '../ui/sourcesList';
import type { StatusBar } from '../ui/statusBar';

export type ChatSessionController = {
  applyRecord: (chat: ChatRecord) => void;
  beginNew: () => void;
  selectById: (id: string) => void;
};

export function createChatSessionController(deps: {
  input: HTMLInputElement;
  status: StatusBar;
  answer: AnswerPanel;
  sources: SourcesList;
  history: ChatHistoryView;
  onAfterNavigate?: () => void;
}): ChatSessionController {
  const { input, status, answer, sources, history, onAfterNavigate } = deps;

  function applyRecord(chat: ChatRecord) {
    setCurrentChatId(chat.id);
    input.value = chat.query;

    if (chat.error) {
      status.set(`Ollama error: ${chat.error}`, true);
    } else {
      status.clear();
    }

    if (chat.answerRaw) {
      answer.setFromMarkdown(chat.answerRaw);
    } else {
      answer.clear();
      answer.hideSection();
    }

    sources.render(chat.sources);
    history.syncActive();
  }

  function beginNew() {
    setCurrentChatId(null);
    input.value = '';
    answer.clear();
    answer.hideSection();
    sources.clear();
    status.clear();
    history.syncActive();
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
