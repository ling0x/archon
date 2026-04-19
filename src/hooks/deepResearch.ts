const STORAGE_KEY = 'archon-deep-research';

/**
 * Sync deep research toggle state across all composers.
 * Toggle state is persisted in localStorage.
 */
export function syncDeepResearchToggle(mainEl: HTMLElement): void {
  const isOn = localStorage.getItem(STORAGE_KEY) === '1';

  mainEl.querySelectorAll<HTMLInputElement>('.archon-deep-toggle').forEach((el) => {
    el.checked = isOn;
  });

  mainEl.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('archon-deep-toggle')) {
      return;
    }

    const checked = target.checked;
    mainEl.querySelectorAll<HTMLInputElement>('.archon-deep-toggle').forEach((el) => {
      el.checked = checked;
    });

    localStorage.setItem(STORAGE_KEY, checked ? '1' : '0');
  });
}