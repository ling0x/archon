// =============================================================================
// Ollama Answer Streaming
// =============================================================================

import type { PriorTurn, StreamChunk, StreamAnswerOptions } from '../../types';
import { streamGenerate } from './api';
import { OLLAMA_ANSWER_NUM_CTX, OLLAMA_DEEP_ANSWER_NUM_CTX } from './constants';
import { buildPriorBlockForAnswer } from './prior';
import { SYSTEM_PROMPT_GROUNDED, SYSTEM_PROMPT_NO_RESULTS, SYSTEM_PROMPT_TWO_PASS } from './prompts';

function buildUserMessage(
  query: string,
  searchContext: string,
  prior: string,
  hasSearch: boolean,
  twoPass: boolean,
  draftNotes: string,
  searchQueryNote: string,
): string {
  const draftBlock = twoPass && draftNotes.length > 0
    ? ['--- Draft research notes (pass 1) ---', draftNotes, '--- End draft notes ---', ''].join('\n')
    : '';

  const resultsBody = hasSearch
    ? searchContext.trim().length > 0
      ? searchContext
      : '(No excerpt text was returned for the retrieved URLs.)'
    : '(No pages were retrieved — the search returned zero results.)';

  return [
    prior,
    searchQueryNote,
    `Current question: ${query}`,
    '',
    draftBlock,
    '--- Search Results ---',
    resultsBody,
    '--- End of Search Results ---',
    '',
    hasSearch
      ? twoPass
        ? 'Write the final answer for the current question using the draft notes and search excerpts, with [[n]] citations for web-sourced facts.'
        : 'Answer the current question using the search results above, with [[n]] citations as specified.'
      : 'Follow the instructions for the no-results case.',
  ].join('\n');
}

export type { StreamChunk };

export async function* streamOllamaAnswer(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: StreamAnswerOptions,
): AsyncGenerator<StreamChunk> {
  const hasSearch = options.hasSearchResults;
  const twoPass = Boolean(options.twoPassSynthesis && options.intermediateResearchNotes?.trim()) && hasSearch;

  const systemPrompt = hasSearch
    ? twoPass
      ? SYSTEM_PROMPT_TWO_PASS
      : SYSTEM_PROMPT_GROUNDED
    : SYSTEM_PROMPT_NO_RESULTS;

  const prior = buildPriorBlockForAnswer(priorTurns, { deepResearch: options.deepResearch });

  const sq = options.searchQueryUsed?.trim() ?? '';
  const searchQueryNote = sq.length === 0
    ? ''
    : hasSearch
      ? `Web pages below were retrieved using these search queries: ${sq}\n\n`
      : `Web search was attempted (no results) with: ${sq}\n\n`;

  const draftNotes = options.intermediateResearchNotes?.trim() ?? '';

  const userMessage = buildUserMessage(
    query,
    searchContext,
    prior,
    hasSearch,
    twoPass,
    draftNotes,
    searchQueryNote,
  );

  const numCtx = options.deepResearch ? OLLAMA_DEEP_ANSWER_NUM_CTX : OLLAMA_ANSWER_NUM_CTX;

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    prompt: userMessage,
    stream: true,
    options: {
      temperature: 0.2,
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