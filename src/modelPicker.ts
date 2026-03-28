const STORAGE_KEY = 'archon-ollama-model';
const FALLBACK_MODEL = 'gpt-oss:20b';

export async function initModelSelect(select: HTMLSelectElement): Promise<void> {
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

  select.innerHTML = '';

  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = FALLBACK_MODEL;
    opt.textContent = FALLBACK_MODEL;
    select.appendChild(opt);
    select.value = FALLBACK_MODEL;
  } else {
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && names.includes(stored)) {
      select.value = stored;
    } else if (names.includes(FALLBACK_MODEL)) {
      select.value = FALLBACK_MODEL;
    } else {
      select.selectedIndex = 0;
    }
  }

  select.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY, select.value);
  });
}

export function getSelectedModel(select: HTMLSelectElement): string {
  const v = select.value?.trim();
  return v || FALLBACK_MODEL;
}
