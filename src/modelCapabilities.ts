/** Cached Ollama `/api/show` capability lists by exact model name (e.g. `deepseek-r1:32b`). */
const capsCache = new Map<string, string[] | null>();

export async function fetchModelCapabilities(model: string): Promise<string[] | null> {
  const key = model.trim();
  if (!key) return null;
  if (capsCache.has(key)) return capsCache.get(key) ?? null;

  try {
    const res = await fetch('/ollama/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: key }),
    });
    if (!res.ok) {
      capsCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { capabilities?: unknown };
    const c = data.capabilities;
    const list =
      Array.isArray(c) && c.every((x): x is string => typeof x === 'string')
        ? c
        : null;
    capsCache.set(key, list);
    return list;
  } catch {
    capsCache.set(key, null);
    return null;
  }
}

export function capabilitiesIncludeThinking(caps: string[] | null): boolean {
  return caps !== null && caps.includes('thinking');
}

export async function modelSupportsThinking(model: string): Promise<boolean> {
  const caps = await fetchModelCapabilities(model);
  return capabilitiesIncludeThinking(caps);
}

/**
 * Default Ollama `think` for reasoning-capable models. GPT-OSS expects a level, not booleans.
 */
export function defaultThinkParameter(model: string): boolean | 'low' | 'medium' | 'high' {
  const base = model.split(':')[0]?.toLowerCase() ?? '';
  if (base.includes('gpt-oss')) return 'medium';
  return true;
}
