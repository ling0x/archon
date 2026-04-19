// =============================================================================
// Status Bar
// =============================================================================

import type { StatusBar } from '../types';

export type { StatusBar };

export function createStatusBar(mainStatusSlot: HTMLElement, mainPanel: HTMLElement): StatusBar {
  let target = mainStatusSlot;

  function paint(msg: string, isError: boolean, hide: boolean): void {
    if (hide) {
      target.classList.add('hidden');
      target.textContent = '';
      target.classList.remove('error');
    } else {
      target.textContent = msg;
      target.classList.remove('hidden', 'error');
      if (isError) target.classList.add('error');
    }
  }

  return {
    setTarget(el: HTMLElement): void {
      target = el;
    },

    set(msg: string, isError = false): void {
      paint(msg, isError, false);
    },

    clear(): void {
      paint('', false, true);
    },

    clearAll(): void {
      target = mainStatusSlot;
      mainPanel.querySelectorAll<HTMLElement>('.composer-status').forEach((el) => {
        el.classList.add('hidden');
        el.textContent = '';
        el.classList.remove('error');
      });
    },
  };
}

/** Status line under the composer that submitted the current search. */
export function statusSlotForSubmittedForm(form: HTMLFormElement, mainStatusSlot: HTMLElement): HTMLElement {
  const slot = form.closest('.composer-strip')?.querySelector<HTMLElement>('.composer-status');
  return slot ?? mainStatusSlot;
}

/** Last follow-up strip's status (active composer when a thread is open). */
export function statusSlotAtConversationTail(mainPanel: HTMLElement, mainStatusSlot: HTMLElement): HTMLElement {
  const strips = mainPanel.querySelectorAll<HTMLElement>('#conversation .turn-followup-strip .composer-status');
  return strips[strips.length - 1] ?? mainStatusSlot;
}