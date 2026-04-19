// =============================================================================
// Ollama API Client
// =============================================================================

import type { OllamaStreamChunk } from '../../types';

const API_BASE = '/ollama/api';

/**
 * Stream generate response from Ollama.
 * Yields parsed chunks until done, then returns final response.
 */
export async function* streamGenerate(
  body: Record<string, unknown>,
): AsyncGenerator<OllamaStreamChunk, string, undefined> {
  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        if (chunk.response) {
          text += chunk.response;
        }
        yield chunk;
        if (chunk.done) return text;
      } catch {
        // skip malformed lines
      }
    }
  }

  return text;
}

/**
 * Non-streaming generate request.
 */
export async function generate(
  body: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  return typeof data.response === 'string' ? data.response : '';
}