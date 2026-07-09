// =============================================================================
// llama.cpp Server API Client (OpenAI-compatible chat completions)
// =============================================================================

import type { OllamaStreamChunk } from '../types';

const API_BASE = '/llamacpp/v1';

function ollamaBodyToChatCompletion(body: Record<string, unknown>): Record<string, unknown> {
  const model = String(body.model ?? '');
  const system = typeof body.system === 'string' ? body.system : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const stream = body.stream !== false;
  const options = (body.options ?? {}) as Record<string, unknown>;

  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream,
    temperature: options.temperature ?? 0.2,
    top_p: options.top_p ?? 0.9,
  };

  if (typeof options.num_predict === 'number') {
    payload.max_tokens = options.num_predict;
  }

  const think = body.think;
  if (think !== undefined) {
    payload.chat_template_kwargs = { enable_thinking: think !== false };
    payload.reasoning_format = 'deepseek';
  }

  return payload;
}

function deltaFromChunk(parsed: Record<string, unknown>): { response?: string; thinking?: string } {
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return {};

  const choice = choices[0];
  if (choice === null || typeof choice !== 'object') return {};

  const delta = (choice as Record<string, unknown>).delta ?? (choice as Record<string, unknown>).message;
  if (delta === null || typeof delta !== 'object') return {};

  const d = delta as Record<string, unknown>;
  const out: { response?: string; thinking?: string } = {};

  if (typeof d.content === 'string' && d.content.length > 0) {
    out.response = d.content;
  }
  if (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) {
    out.thinking = d.reasoning_content;
  }

  return out;
}

/**
 * Stream chat completion from llama.cpp, yielding Ollama-shaped chunks.
 */
export async function* streamLlamacppGenerate(
  body: Record<string, unknown>,
): AsyncGenerator<OllamaStreamChunk, string, undefined> {
  const payload = ollamaBodyToChatCompletion(body);
  const model = String(payload.model ?? '');

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`llama.cpp error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body from llama.cpp');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) break;

      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);

      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const { response: chunkText, thinking } = deltaFromChunk(parsed);

        if (chunkText) text += chunkText;

        if (chunkText || thinking) {
          yield {
            model,
            response: chunkText ?? '',
            thinking,
            done: false,
          };
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  yield { model, response: '', done: true };
  return text;
}

/**
 * Non-streaming chat completion from llama.cpp.
 */
export async function llamacppGenerate(body: Record<string, unknown>): Promise<string> {
  const payload = { ...ollamaBodyToChatCompletion(body), stream: false };

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`llama.cpp error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';

  const choice = choices[0];
  if (choice === null || typeof choice !== 'object') return '';

  const message = (choice as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object') {
    const text = (choice as Record<string, unknown>).text;
    return typeof text === 'string' ? text : '';
  }

  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}
