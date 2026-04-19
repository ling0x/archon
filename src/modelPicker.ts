// =============================================================================
// Model Picker
// =============================================================================

import { capabilitiesIncludeThinking, fetchModelCapabilities } from './modelCapabilities';

const STORAGE_KEY = 'archon-ollama-model';
const FALLBACK_MODEL: string = __OLLAMA_FALLBACK_MODEL__;

function syncAllModelSelects(source: HTMLSelectElement): void {
  const html = source.innerHTML;
  const val = source.value;

  document.querySelectorAll<HTMLSelectElement>('.composer-model-select').forEach((s) => {
    if (s === source) return;
    s.innerHTML = html;
    s.value = val;
  });

  localStorage.setItem(STORAGE_KEY, val);
}

export async function refreshReasoningTagForModel(model: string): Promise<void> {
  const caps = await fetchModelCapabilities(model);
  const supported = capabilitiesIncludeThinking(caps);

  document.querySelectorAll<HTMLElement>('.composer-reasoning-tag').forEach((el) => {
    const inactive = el.classList.contains('is-followup-inactive');
    const hidden = !supported || inactive;
    el.classList.toggle('hidden', hidden);
    el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  });
}

function replicateModelOptionsFrom(primary: HTMLSelectElement): void {
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
  mainPanel?: HTMLElement | null,
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

  replicateModelOptionsFrom(primarySelect);
  void refreshReasoningTagForModel(getSelectedModel(primarySelect));

  const panel = (mainPanel ?? primarySelect.closest('#main-panel')) as HTMLElement | null;
  if (panel && !panel.dataset.archonModelSyncBound) {
    panel.dataset.archonModelSyncBound = '1';
    panel.addEventListener('change', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement) || !target.classList.contains('composer-model-select')) {
        return;
      }
      syncAllModelSelects(target);
      void refreshReasoningTagForModel(target.value?.trim() || FALLBACK_MODEL);
    });
  }
}

export function getSelectedModel(select: HTMLSelectElement): string {
  const v = select.value?.trim();
  return v || FALLBACK_MODEL;
}