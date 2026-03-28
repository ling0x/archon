function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

export type AppElements = {
  appShell: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  submitBtn: HTMLButtonElement;
  btnLabel: HTMLSpanElement;
  statusEl: HTMLElement;
  answerSec: HTMLElement;
  answerEl: HTMLElement;
  sourcesSec: HTMLElement;
  sourcesEl: HTMLUListElement;
  newChatBtn: HTMLButtonElement;
  chatHistoryEl: HTMLUListElement;
  sidebarOpenBtn: HTMLButtonElement;
  sidebarBackdrop: HTMLElement;
};

export function getAppElements(): AppElements {
  return {
    appShell: req('app-shell'),
    form: req<HTMLFormElement>('search-form'),
    input: req<HTMLInputElement>('query-input'),
    submitBtn: req<HTMLButtonElement>('submit-btn'),
    btnLabel: req<HTMLSpanElement>('btn-label'),
    statusEl: req('status'),
    answerSec: req('answer-section'),
    answerEl: req('answer'),
    sourcesSec: req('sources-section'),
    sourcesEl: req<HTMLUListElement>('sources'),
    newChatBtn: req<HTMLButtonElement>('new-chat-btn'),
    chatHistoryEl: req<HTMLUListElement>('chat-history'),
    sidebarOpenBtn: req<HTMLButtonElement>('sidebar-open-btn'),
    sidebarBackdrop: req('sidebar-backdrop'),
  };
}
