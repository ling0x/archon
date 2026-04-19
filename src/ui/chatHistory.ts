// =============================================================================
// Chat History View
// =============================================================================

import { chatHasError, chatTitle, loadChats, deleteChat } from '../chatStorage';
import { getCurrentChatId, setCurrentChatId } from '../session';
import { formatChatTime, truncate } from './format';

export type ChatHistoryView = {
  render: () => void;
  syncActive: () => void;
};

const DELETE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

function confirmDelete(chatTitle: string): boolean {
  return window.confirm(`Delete "${chatTitle}"?\n\nThis cannot be undone.`);
}

export function createChatHistoryView(opts: {
  listEl: HTMLUListElement;
  onSelect: (id: string) => void;
}): ChatHistoryView {
  const { listEl, onSelect } = opts;

  function syncActive(): void {
    const currentId = getCurrentChatId();
    listEl.querySelectorAll('.chat-history-item').forEach((el) => {
      const id = el.getAttribute('data-id');
      el.classList.toggle('active', id !== null && id === currentId);
    });
  }

  function render(): void {
    const chats = loadChats();
    listEl.innerHTML = '';

    if (chats.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'chat-history-empty';
      empty.textContent = 'No saved chats yet. Your questions and answers appear here.';
      listEl.appendChild(empty);
      return;
    }

    chats.forEach((chat) => {
      const li = document.createElement('li');
      li.className = 'chat-history-item';
      li.dataset.id = chat.id;
      if (chat.id === getCurrentChatId()) {
        li.classList.add('active');
      }

      const title = document.createElement('span');
      title.className = 'chat-history-title';
      title.textContent = truncate(chatTitle(chat), 56);

      const meta = document.createElement('span');
      meta.className = 'chat-history-meta';
      meta.textContent = formatChatTime(chat.updatedAt);

      if (chatHasError(chat)) {
        meta.textContent += ' · Error';
      }

      const turnsHint = chat.turns.length > 1 ? ` · ${chat.turns.length} messages` : '';
      meta.textContent += turnsHint;

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'chat-history-delete';
      deleteBtn.title = 'Delete chat';
      deleteBtn.setAttribute('aria-label', `Delete "${chatTitle(chat)}"`);
      deleteBtn.innerHTML = DELETE_ICON;

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = chatTitle(chat);
        if (!confirmDelete(title)) return;

        const wasActive = chat.id === getCurrentChatId();

        if (deleteChat(chat.id)) {
          render();
          if (wasActive) {
            setCurrentChatId(null);
            // Trigger new chat state - emit a custom event for main.ts to handle
            listEl.dispatchEvent(new CustomEvent('chat-deleted', {
              detail: { id: chat.id },
              bubbles: true,
            }));
          }
        }
      });

      li.append(title, meta, deleteBtn);
      li.addEventListener('click', () => onSelect(chat.id));
      listEl.appendChild(li);
    });
  }

  return { render, syncActive };
}