import { getChatById } from '../chatStorage';
import { getCurrentChatId } from '../session';

/** Hide the top composer when the active thread has at least one turn (inline composers take over). */
export function updateTopFormVisibility(mainEl: HTMLElement): void {
  const form = mainEl.querySelector('#search-form');
  if (!form) return;
  const id = getCurrentChatId();
  const chat = id ? getChatById(id) : undefined;
  const hasThread = !!(chat && chat.turns.length > 0);
  form.classList.toggle('hidden', hasThread);
}

export type ComposerPhase =
  | 'idle'
  | 'formulating'
  | 'searching'
  | 'thinking';

export function setComposerBusyState(
  mainEl: HTMLElement,
  phase: ComposerPhase,
): void {
  const busy = phase !== 'idle';
  const label =
    phase === 'searching'
      ? 'Searching…'
      : phase === 'thinking'
        ? 'Thinking…'
        : phase === 'formulating'
          ? 'Preparing…'
          : 'Search';

  mainEl
    .querySelectorAll<HTMLInputElement>('.composer-input')
    .forEach((inp) => {
      const inactive = inp.classList.contains('is-followup-inactive');
      inp.disabled = busy || inactive;
    });
  mainEl.querySelectorAll<HTMLButtonElement>('.composer-submit-btn').forEach((btn) => {
    const inactive = btn.classList.contains('is-followup-inactive');
    btn.disabled = busy || inactive;
  });
  mainEl.querySelectorAll<HTMLSpanElement>('.composer-submit-label').forEach((el) => {
    el.textContent = label;
  });
  mainEl.querySelectorAll<HTMLSelectElement>('.composer-model-select').forEach((sel) => {
    sel.disabled = busy;
  });
}
