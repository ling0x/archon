// =============================================================================
// Thread Chrome - Top form visibility and composer busy states
// =============================================================================

import type { ComposerPhase } from '../types';
import { getChatById } from '../chatStorage';
import { getCurrentChatId } from '../session';

/** Hide the top composer when a thread is active (inline composers take over). */
export function updateTopFormVisibility(mainEl: HTMLElement): void {
  const form = mainEl.querySelector('#search-form');
  if (!form) return;

  const id = getCurrentChatId();
  const chat = id ? getChatById(id) : undefined;
  const hasThread = !!(chat && chat.turns.length > 0);

  form.classList.toggle('hidden', hasThread);
}

/** Update UI to reflect the current composer phase. */
export function setComposerBusyState(mainEl: HTMLElement, phase: ComposerPhase): void {
  const busy = phase !== 'idle';

  const label = phase === 'searching'
    ? 'Searching…'
    : phase === 'thinking'
      ? 'Thinking…'
      : phase === 'formulating'
        ? 'Preparing…'
        : 'Search';

  mainEl.querySelectorAll<HTMLTextAreaElement>('.composer-input').forEach((inp) => {
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
    const inactive = sel.classList.contains('is-followup-inactive');
    sel.disabled = busy || inactive;
  });

  mainEl.querySelectorAll<HTMLInputElement>('.archon-deep-toggle').forEach((cb) => {
    const inactive = cb.classList.contains('is-followup-inactive');
    cb.disabled = busy || inactive;
  });
}