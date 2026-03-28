export type MobileSidebar = {
  open: () => void;
  close: () => void;
  bind: () => void;
};

function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

export function createMobileSidebar(opts: {
  appShell: HTMLElement;
  backdrop: HTMLElement;
  toggleBtn: HTMLButtonElement;
}): MobileSidebar {
  const { appShell, backdrop, toggleBtn } = opts;

  function open() {
    if (!isMobileLayout()) return;
    appShell.classList.add('sidebar-open');
    backdrop.classList.remove('hidden');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    appShell.classList.remove('sidebar-open');
    backdrop.classList.add('hidden');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function bind() {
    toggleBtn.addEventListener('click', () => {
      if (appShell.classList.contains('sidebar-open')) close();
      else open();
    });
    backdrop.addEventListener('click', () => close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    window.addEventListener('resize', () => {
      if (!isMobileLayout()) close();
    });
  }

  return { open, close, bind };
}
