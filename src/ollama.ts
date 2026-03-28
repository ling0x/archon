export interface OllamaStreamChunk {
  model: string;
  response: string;
  done: boolean;
}

export type PriorTurn = { query: string; answer: string };

export function buildPriorBlock(priorTurns: readonly PriorTurn[]): string {
  if (priorTurns.length === 0) return '';
  const body = priorTurns
    .map(
      (t, i) =>
        `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${t.answer}`,
    )
    .join('\n\n');
  return [
    '--- Earlier in this conversation ---',
    body,
    '--- End earlier conversation ---',
    '',
  ].join('\n');
}

function sanitizeSearchQueryLine(raw: string, fallback: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('“') && s.endsWith('”'))
  ) {
    s = s.slice(1, -1).trim();
  }
  const line = s.split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return fallback;
  return line.slice(0, 400);
}

/**
 * Turn a follow-up message plus conversation history into a short SearXNG-friendly query.
 */
export async function formulateSearchQuery(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  model = 'gpt-oss:20b',
): Promise<string> {
  const prior = buildPriorBlock(priorTurns);
  const system = [
    'You write concise web search queries for a search engine (SearXNG).',
    'Reply with a single line only: search keywords and short phrases, no quotes, no labels like "Query:", no explanation.',
    'Use the prior conversation so vague follow-ups (e.g. "the second option", "more on that") become a concrete, searchable query.',
    'If the latest message is already a good search phrase, output it or improve it slightly.',
  ].join(' ');

  const prompt = [
    prior,
    `Latest user message: ${userMessage}`,
    '',
    'Output only the search query text.',
  ].join('\n');

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 160 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const text = typeof data.response === 'string' ? data.response : '';
  return sanitizeSearchQueryLine(text, userMessage);
}

export type StreamAnswerOptions = {
  /** Actual SearXNG query used (esp. after formulateSearchQuery on follow-ups). */
  searchQueryUsed?: string;
};

export async function* streamOllamaAnswer(
  query: string,
  searchContext: string,
  priorTurns: PriorTurn[] = [],
  model = 'gpt-oss:20b',
  options?: StreamAnswerOptions,
): AsyncGenerator<string> {
  const systemPrompt = [
    'You are a helpful assistant that answers questions based on provided web search results.',
    'Use the search results below as your primary source of information for the current question.',
    'Be concise, accurate, and cite facts from the sources when relevant.',
    'If the search results are not sufficient, say so clearly.',
    'When the user asks a follow-up, use earlier conversation turns only for context; still ground answers in the search results for the current question.',
  ].join(' ');

  const prior = buildPriorBlock(priorTurns);

  const searchQueryNote =
    options?.searchQueryUsed &&
    options.searchQueryUsed.trim().length > 0
      ? `Web pages below were retrieved using this search query: ${options.searchQueryUsed.trim()}\n\n`
      : '';

  const userMessage = [
    prior,
    searchQueryNote,
    `Current question: ${query}`,
    '',
    '--- Search Results ---',
    searchContext,
    '--- End of Search Results ---',
    '',
    'Answer the current question using the search results above.',
  ].join('\n');

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      prompt: userMessage,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  if (!res.body) throw new Error('No response body from Ollama');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        if (chunk.response) yield chunk.response;
        if (chunk.done) return;
      } catch {
        // skip malformed lines
      }
    }
  }
}
