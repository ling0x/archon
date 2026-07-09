// =============================================================================
// Model Capabilities
// =============================================================================

import { parseModelRef } from './llm/modelRef';

const capsCache = new Map<string, string[] | null>();
const llamacppCaps = new Map<string, string[]>();

export function setLlamacppModelCapabilities(capsByName: Map<string, string[]>): void {
  llamacppCaps.clear();
  for (const [name, caps] of capsByName) {
    llamacppCaps.set(name, caps);
    capsCache.set(`llamacpp/${name}`, caps);
  }
}

export async function fetchModelCapabilities(model: string): Promise<string[] | null> {
  const key = model.trim();
  if (!key) return null;
  if (capsCache.has(key)) return capsCache.get(key) ?? null;

  const { provider, model: modelName } = parseModelRef(key);

  if (provider === 'llamacpp') {
    const caps = llamacppCaps.get(modelName) ?? null;
    capsCache.set(key, caps);
    return caps;
  }

  try {
    const res = await fetch('/ollama/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!res.ok) {
      capsCache.set(key, null);
      return null;
    }

    const data = (await res.json()) as { capabilities?: unknown };
    const c = data.capabilities;

    const list = Array.isArray(c) && c.every((x): x is string => typeof x === 'string')
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
  if (caps === null) return false;
  return caps.includes('thinking') || caps.includes('reasoning');
}

export async function modelSupportsThinking(model: string): Promise<boolean> {
  const caps = await fetchModelCapabilities(model);
  return capabilitiesIncludeThinking(caps);
}

/**
 * Default `think` parameter for reasoning-capable models.
 */
export function defaultThinkParameter(model: string): boolean | 'low' | 'medium' | 'high' {
  const { model: modelName } = parseModelRef(model);
  const base = modelName.split(':')[0]?.toLowerCase() ?? '';
  if (base.includes('gpt-oss')) return 'medium';
  return true;
}
