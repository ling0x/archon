export type StatusBar = {
  set: (msg: string, isError?: boolean) => void;
  clear: () => void;
};

export function createStatusBar(statusEl: HTMLElement): StatusBar {
  return {
    set(msg: string, isError = false) {
      statusEl.textContent = msg;
      statusEl.classList.remove('hidden', 'error');
      if (isError) statusEl.classList.add('error');
    },
    clear() {
      statusEl.classList.add('hidden');
      statusEl.textContent = '';
    },
  };
}
