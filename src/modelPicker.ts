// =============================================================================
// Model Picker
// =============================================================================

import { formatModelRef } from './llm/modelRef';
import { capabilitiesIncludeThinking, fetchModelCapabilities, setLlamacppModelCapabilities } from './modelCapabilities';

const STORAGE_KEY = 'archon-ollama-model';
const FALLBACK_MODEL: string = __OLLAMA_FALLBACK_MODEL__;

interface ListedModel {
  value: string;
  label: string;
  group: 'ollama' | 'llamacpp';
}

async function fetchOllamaModels(): Promise<ListedModel[]> {
  try {
    const res = await fetch('/ollama/api/tags');
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map((name) => ({ value: formatModelRef({ provider: 'ollama', model: name }), label: name, group: 'ollama' as const }));
  } catch {
    return [];
  }
}

async function fetchLlamacppModels(): Promise<ListedModel[]> {
  try {
    const res = await fetch('/llamacpp/v1/models');
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      models?: { name?: string; model?: string; capabilities?: string[] }[];
      data?: { id?: string; capabilities?: string[] }[];
    };

    const capsByName = new Map<string, string[]>();
    const names = new Set<string>();

    for (const entry of data.models ?? []) {
      const name = entry.name ?? entry.model;
      if (typeof name !== 'string' || !name) continue;
      names.add(name);
      if (Array.isArray(entry.capabilities)) {
        capsByName.set(name, entry.capabilities.filter((c): c is string => typeof c === 'string'));
      }
    }

    for (const entry of data.data ?? []) {
      if (typeof entry.id !== 'string' || !entry.id) continue;
      names.add(entry.id);
      if (Array.isArray(entry.capabilities) && !capsByName.has(entry.id)) {
        capsByName.set(entry.id, entry.capabilities.filter((c): c is string => typeof c === 'string'));
      }
    }

    setLlamacppModelCapabilities(capsByName);

    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        value: formatModelRef({ provider: 'llamacpp', model: name }),
        label: name,
        group: 'llamacpp' as const,
      }));
  } catch {
    return [];
  }
}

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

function appendModelGroup(
  select: HTMLSelectElement,
  label: string,
  models: ListedModel[],
): void {
  if (models.length === 0) return;

  const group = document.createElement('optgroup');
  group.label = label;

  for (const entry of models) {
    const opt = document.createElement('option');
    opt.value = entry.value;
    opt.textContent = entry.label;
    group.appendChild(opt);
  }

  select.appendChild(group);
}

export async function initModelSelect(
  primarySelect: HTMLSelectElement,
  mainPanel?: HTMLElement | null,
): Promise<void> {
  const [ollamaModels, llamacppModels] = await Promise.all([
    fetchOllamaModels(),
    fetchLlamacppModels(),
  ]);

  const names = [...ollamaModels, ...llamacppModels].map((m) => m.value);

  primarySelect.innerHTML = '';

  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = FALLBACK_MODEL;
    opt.textContent = FALLBACK_MODEL;
    primarySelect.appendChild(opt);
    primarySelect.value = FALLBACK_MODEL;
  } else {
    appendModelGroup(primarySelect, 'Ollama', ollamaModels);
    appendModelGroup(primarySelect, 'llama.cpp', llamacppModels);

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
