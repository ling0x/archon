// =============================================================================
// Mobile Sidebar
// =============================================================================

import type { MobileSidebar } from '../types';

export type { MobileSidebar };

function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 1200px)').matches;
}

export function createMobileSidebar(opts: {
  appShell: HTMLElement;
  backdrop: HTMLElement;
  toggleBtn: HTMLButtonElement;
}): MobileSidebar {
  const { appShell, backdrop, toggleBtn } = opts;

  function open(): void {
    if (!isMobileLayout()) return;
    appShell.classList.add('sidebar-open');
    backdrop.classList.remove('hidden');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function close(): void {
    appShell.classList.remove('sidebar-open');
    backdrop.classList.add('hidden');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function bind(): void {
    toggleBtn.addEventListener('click', () => {
      if (appShell.classList.contains('sidebar-open')) {
        close();
      } else {
        open();
      }
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