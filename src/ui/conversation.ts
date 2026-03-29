import type { ChatRecord, ChatTurn } from '../chatStorage';
import { renderAnswerMarkdown } from '../markdown';
import type { SearchResult } from '../searxng';
import { escapeHtml } from '../utils/html';

function renderSourcesList(parent: HTMLElement, results: SearchResult[]): void {
  parent.innerHTML = '';
  if (results.length === 0) {
    parent.classList.add('hidden');
    return;
  }
  parent.classList.remove('hidden');

  const h = document.createElement('h3');
  h.className = 'turn-sources-heading';
  h.textContent = 'Sources';

  const ul = document.createElement('ul');
  ul.className = 'sources turn-sources-list';

  results.forEach((r) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = `
      <span class="source-title">${escapeHtml(r.title || r.url)}</span>
      <span class="source-url">${escapeHtml(r.url)}</span>
    `;
    li.appendChild(a);
    ul.appendChild(li);
  });

  parent.append(h, ul);
}

function renderTurnContent(aEl: HTMLElement, turn: ChatTurn): void {
  let html = '';
  if (turn.error) {
    html += `<p class="turn-error-note">${escapeHtml(turn.error)}</p>`;
  }
  if (turn.answerRaw) {
    html += renderAnswerMarkdown(turn.answerRaw, turn.sources);
  }
  aEl.innerHTML = html;
}

function createFollowupSlot(isLast: boolean): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'turn-followup';
  form.setAttribute('aria-label', 'Follow-up question');

  const row = document.createElement('div');
  row.className = 'input-row turn-followup-row';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'composer-input turn-followup-input';
  inp.autocomplete = 'off';
  if (isLast) {
    inp.placeholder = 'Ask a follow-up…';
  } else {
    inp.placeholder = 'Continue with the composer below';
    inp.classList.add('is-followup-inactive');
  }

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'submit-btn composer-submit-btn turn-followup-submit';
  if (!isLast) btn.classList.add('is-followup-inactive');

  const span = document.createElement('span');
  span.className = 'btn-label composer-submit-label';
  span.textContent = 'Search';
  btn.appendChild(span);

  row.append(inp, btn);
  form.appendChild(row);
  return form;
}

export type TurnUi = {
  setSources: (results: SearchResult[]) => void;
  setAnswerMarkdown: (raw: string) => void;
};

export type ConversationView = {
  clear: () => void;
  show: () => void;
  hide: () => void;
  renderChat: (chat: ChatRecord) => void;
  startTurn: (query: string) => TurnUi;
  scrollToBottom: () => void;
};

export function createConversationView(
  container: HTMLElement,
  section: HTMLElement,
): ConversationView {
  function scrollToBottom() {
    container.scrollTop = container.scrollHeight;
  }

  return {
    clear() {
      container.innerHTML = '';
    },
    show() {
      section.classList.remove('hidden');
    },
    hide() {
      section.classList.add('hidden');
    },
    renderChat(chat: ChatRecord) {
      container.innerHTML = '';
      const n = chat.turns.length;
      chat.turns.forEach((turn, index) => {
        const article = document.createElement('article');
        article.className = 'turn';
        article.dataset.turnId = turn.id;

        const qEl = document.createElement('div');
        qEl.className = 'turn-query';
        qEl.textContent = turn.query;

        const srcWrap = document.createElement('div');
        srcWrap.className = 'turn-sources';

        const aEl = document.createElement('div');
        aEl.className = 'turn-answer markdown-body';

        renderTurnContent(aEl, turn);
        renderSourcesList(srcWrap, turn.sources);

        article.append(qEl, srcWrap, aEl);
        container.appendChild(article);

        const isLast = index === n - 1;
        container.appendChild(createFollowupSlot(isLast));
      });
      section.classList.remove('hidden');
      scrollToBottom();
      requestAnimationFrame(() => {
        container
          .querySelector<HTMLInputElement>(
            '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
          )
          ?.focus();
      });
    },

    startTurn(query: string): TurnUi {
      const article = document.createElement('article');
      article.className = 'turn turn-pending';

      const qEl = document.createElement('div');
      qEl.className = 'turn-query';
      qEl.textContent = query;

      const srcWrap = document.createElement('div');
      srcWrap.className = 'turn-sources hidden';

      const aEl = document.createElement('div');
      aEl.className = 'turn-answer markdown-body';

      article.append(qEl, srcWrap, aEl);
      container.appendChild(article);
      section.classList.remove('hidden');
      scrollToBottom();

      let turnSources: SearchResult[] = [];

      return {
        setSources(results: SearchResult[]) {
          turnSources = results;
          renderSourcesList(srcWrap, results);
        },
        setAnswerMarkdown(raw: string) {
          aEl.innerHTML = renderAnswerMarkdown(raw, turnSources);
          scrollToBottom();
        },
      };
    },

    scrollToBottom,
  };
}
