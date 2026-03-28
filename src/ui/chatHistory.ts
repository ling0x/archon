import { chatHasError, chatTitle, loadChats } from '../chatStorage';
import { getCurrentChatId } from '../session';
import { formatChatTime, truncate } from '../utils/format';

export type ChatHistoryView = {
  render: () => void;
  syncActive: () => void;
};

export function createChatHistoryView(opts: {
  listEl: HTMLUListElement;
  onSelect: (id: string) => void;
}): ChatHistoryView {
  const { listEl, onSelect } = opts;

  function syncActive() {
    const currentId = getCurrentChatId();
    listEl.querySelectorAll('.chat-history-item').forEach((el) => {
      const id = el.getAttribute('data-id');
      el.classList.toggle('active', id !== null && id === currentId);
    });
  }

  function render() {
    const chats = loadChats();
    listEl.innerHTML = '';
    if (chats.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'chat-history-empty';
      empty.textContent =
        'No saved chats yet. Your questions and answers appear here.';
      listEl.appendChild(empty);
      return;
    }

    chats.forEach((chat) => {
      const li = document.createElement('li');
      li.className = 'chat-history-item';
      li.dataset.id = chat.id;
      if (chat.id === getCurrentChatId()) li.classList.add('active');

      const title = document.createElement('span');
      title.className = 'chat-history-title';
      title.textContent = truncate(chatTitle(chat), 56);

      const meta = document.createElement('span');
      meta.className = 'chat-history-meta';
      meta.textContent = formatChatTime(chat.updatedAt);
      if (chatHasError(chat)) meta.textContent += ' · Error';

      const turnsHint =
        chat.turns.length > 1
          ? ` · ${chat.turns.length} messages`
          : '';
      meta.textContent += turnsHint;

      li.append(title, meta);
      li.addEventListener('click', () => onSelect(chat.id));
      listEl.appendChild(li);
    });
  }

  return { render, syncActive };
}
