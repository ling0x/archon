const STORAGE_KEY = 'archon-ollama-model';
const FALLBACK_MODEL: string = __OLLAMA_FALLBACK_MODEL__;

function syncAllModelSelectsFrom(source: HTMLSelectElement): void {
  const html = source.innerHTML;
  const val = source.value;
  document.querySelectorAll<HTMLSelectElement>('.composer-model-select').forEach((s) => {
    if (s === source) return;
    s.innerHTML = html;
    s.value = val;
  });
  localStorage.setItem(STORAGE_KEY, val);
}

/** Copy options + value from primary to every other `.composer-model-select` (e.g. after load or new follow-up). */
export function replicateModelSelectOptionsFrom(primary: HTMLSelectElement): void {
  const html = primary.innerHTML;
  const val = primary.value;
  document.querySelectorAll<HTMLSelectElement>('.composer-model-select').forEach((s) => {
    if (s === primary) return;
    s.innerHTML = html;
    s.value = val;
  });
}

export async function initModelSelect(
  primarySelect: HTMLSelectElement,
  mainPanel: HTMLElement | null = primarySelect.closest('#main-panel'),
): Promise<void> {
  let names: string[] = [];
  try {
    const res = await fetch('/ollama/api/tags');
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: { name: string }[] };
    names = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    names = [];
  }

  primarySelect.innerHTML = '';

  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = FALLBACK_MODEL;
    opt.textContent = FALLBACK_MODEL;
    primarySelect.appendChild(opt);
    primarySelect.value = FALLBACK_MODEL;
  } else {
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      primarySelect.appendChild(opt);
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && names.includes(stored)) {
      primarySelect.value = stored;
    } else if (names.includes(FALLBACK_MODEL)) {
      primarySelect.value = FALLBACK_MODEL;
    } else {
      primarySelect.selectedIndex = 0;
    }
  }

  replicateModelSelectOptionsFrom(primarySelect);

  if (mainPanel && !mainPanel.dataset.archonModelSyncBound) {
    mainPanel.dataset.archonModelSyncBound = '1';
    mainPanel.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement) || !t.classList.contains('composer-model-select')) {
        return;
      }
      syncAllModelSelectsFrom(t);
    });
  }
}

export function getSelectedModel(select: HTMLSelectElement): string {
  const v = select.value?.trim();
  return v || FALLBACK_MODEL;
}
