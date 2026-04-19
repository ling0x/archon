// =============================================================================
// Research Notes Streaming (Two-Pass Deep Research)
// =============================================================================

import type { PriorTurn, StreamChunk } from '../../types';
import { streamGenerate } from './api';
import { OLLAMA_ANSWER_NUM_CTX, OLLAMA_DEEP_ANSWER_NUM_CTX } from './constants';
import { buildPriorBlockForAnswer } from './prior';
import { SYSTEM_PROMPT_RESEARCH_NOTES } from './prompts';

/**
 * Pass A of two-pass deep research: bullet notes with [[n]] citations.
 */
export async function* streamOllamaResearchNotes(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: { think?: boolean | 'low' | 'medium' | 'high'; deepResearch?: boolean },
): AsyncGenerator<StreamChunk> {
  const prior = buildPriorBlockForAnswer(priorTurns, { deepResearch: options.deepResearch });

  const userMessage = [
    prior,
    `Research question: ${query}`,
    '',
    '--- Search Results ---',
    searchContext.trim() || '(No excerpts.)',
    '--- End of Search Results ---',
    '',
    'Output bullet notes with [[n]] citations as specified.',
  ].join('\n');

  const numCtx = options.deepResearch === true ? OLLAMA_DEEP_ANSWER_NUM_CTX : OLLAMA_ANSWER_NUM_CTX;

  const body: Record<string, unknown> = {
    model,
    system: SYSTEM_PROMPT_RESEARCH_NOTES,
    prompt: userMessage,
    stream: true,
    options: {
      temperature: 0.15,
      top_p: 0.9,
      repeat_penalty: 1.05,
      num_ctx: numCtx,
    },
  };

  if (options.think !== undefined) {
    body.think = options.think;
  }

  for await (const chunk of streamGenerate(body)) {
    if (chunk.thinking) {
      yield { kind: 'thinking', text: chunk.thinking };
    }
    if (chunk.response) {
      yield { kind: 'response', text: chunk.response };
    }
  }
}