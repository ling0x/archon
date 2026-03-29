export type StatusBar = {
  /** Route status messages to a composer’s status line (main or follow-up strip). */
  setTarget: (el: HTMLElement) => void;
  set: (msg: string, isError?: boolean) => void;
  clear: () => void;
  /** Clear every `.composer-status` in the main panel (e.g. new chat). */
  clearAll: () => void;
};

export function createStatusBar(
  mainStatusSlot: HTMLElement,
  mainPanel: HTMLElement,
): StatusBar {
  let target = mainStatusSlot;

  function paint(msg: string, isError: boolean, hide: boolean) {
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
    setTarget(el) {
      target = el;
    },
    set(msg: string, isError = false) {
      paint(msg, isError, false);
    },
    clear() {
      paint('', false, true);
    },
    clearAll() {
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
export function statusSlotForSubmittedForm(
  form: HTMLFormElement,
  mainStatusSlot: HTMLElement,
): HTMLElement {
  const slot = form
    .closest('.composer-strip')
    ?.querySelector<HTMLElement>('.composer-status');
  return slot ?? mainStatusSlot;
}

/** Last follow-up strip’s status (active composer when a thread is open). */
export function statusSlotAtConversationTail(
  mainPanel: HTMLElement,
  mainStatusSlot: HTMLElement,
): HTMLElement {
  const strips = mainPanel.querySelectorAll<HTMLElement>(
    '#conversation .turn-followup-strip .composer-status',
  );
  return strips[strips.length - 1] ?? mainStatusSlot;
}
