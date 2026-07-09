// =============================================================================
// Local LLM model references (Ollama + llama.cpp)
// =============================================================================

export type LlmProvider = 'ollama' | 'llamacpp';

const LLAMACPP_PREFIX = 'llamacpp/';

export interface ModelRef {
  provider: LlmProvider;
  model: string;
}

export function parseModelRef(value: string): ModelRef {
  const trimmed = value.trim();
  if (trimmed.startsWith(LLAMACPP_PREFIX)) {
    return { provider: 'llamacpp', model: trimmed.slice(LLAMACPP_PREFIX.length) };
  }
  return { provider: 'ollama', model: trimmed };
}

export function formatModelRef(ref: ModelRef): string {
  return ref.provider === 'llamacpp' ? `${LLAMACPP_PREFIX}${ref.model}` : ref.model;
}

export function isLlamacppModel(value: string): boolean {
  return parseModelRef(value).provider === 'llamacpp';
}

export function displayModelLabel(value: string): string {
  const { provider, model } = parseModelRef(value);
  if (provider === 'llamacpp') return `${model} (llama.cpp)`;
  return model;
}
