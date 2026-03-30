function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

export type AppElements = {
  appShell: HTMLElement;
  mainEl: HTMLElement;
  modelSelect: HTMLSelectElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  submitBtn: HTMLButtonElement;
  btnLabel: HTMLSpanElement;
  statusEl: HTMLElement;
  conversationSec: HTMLElement;
  conversationEl: HTMLElement;
  newChatBtn: HTMLButtonElement;
  chatHistoryEl: HTMLUListElement;
  sidebarOpenBtn: HTMLButtonElement;
  sidebarBackdrop: HTMLElement;
  themeToggleBtn: HTMLButtonElement;
};

export function getAppElements(): AppElements {
  return {
    appShell: req('app-shell'),
    mainEl: req('main-panel'),
    modelSelect: req<HTMLSelectElement>('model-select'),
    form: req<HTMLFormElement>('search-form'),
    input: req<HTMLTextAreaElement>('query-input'),
    submitBtn: req<HTMLButtonElement>('submit-btn'),
    btnLabel: req<HTMLSpanElement>('btn-label'),
    statusEl: req('main-composer-status'),
    conversationSec: req('conversation-section'),
    conversationEl: req('conversation'),
    newChatBtn: req<HTMLButtonElement>('new-chat-btn'),
    chatHistoryEl: req<HTMLUListElement>('chat-history'),
    sidebarOpenBtn: req<HTMLButtonElement>('sidebar-open-btn'),
    sidebarBackdrop: req('sidebar-backdrop'),
    themeToggleBtn: req<HTMLButtonElement>('theme-toggle-btn'),
  };
}
