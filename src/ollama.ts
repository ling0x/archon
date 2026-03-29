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

/** Model dedicated to turning user intent into SearXNG sub-queries (not the answer model). */
export const SEARCH_FORMULATION_MODEL = 'qwen3.5:9b';

const MAX_SUB_QUERIES = 3;
const MAX_SUBQUERY_LEN = 200;

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
  return line.slice(0, MAX_SUBQUERY_LEN);
}

function stripJsonFence(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function parseQueriesFromModelResponse(raw: string, fallback: string): string[] {
  const text = stripJsonFence(raw);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      const out: string[] = [];
      for (const item of parsed) {
        if (typeof item !== 'string') continue;
        const q = sanitizeSearchQueryLine(item, '');
        if (q) out.push(q);
        if (out.length >= MAX_SUB_QUERIES) break;
      }
      const uniq = [...new Set(out)];
      if (uniq.length > 0) return uniq;
    }
  } catch {
    /* try line split */
  }

  const lines = text
    .split(/\n/)
    .map((l) => sanitizeSearchQueryLine(l, ''))
    .filter(Boolean);
  const fromLines = [...new Set(lines)].slice(0, MAX_SUB_QUERIES);
  if (fromLines.length > 0) return fromLines;

  return [sanitizeSearchQueryLine(fallback, fallback)];
}

/**
 * Split the user’s message (with optional prior turns) into 1–3 SearXNG sub-queries using a fixed small model.
 */
export async function formulateSearchQueries(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
): Promise<string[]> {
  const prior = buildPriorBlock(priorTurns);
  const system = [
    'You split an information need into 1–3 short web search queries for SearXNG.',
    'Reply with ONLY a JSON array of strings, for example: ["rust async book", "tokio tutorial"].',
    'No markdown code fences, no object wrapper, no commentary. Maximum 3 strings.',
    'Each string must be a single line: search keywords and short phrases only, under 120 characters.',
    'If one query is enough, return a one-element array.',
    'Use prior conversation when the latest message is vague (e.g. "the second option", "more on that").',
  ].join(' ');

  const prompt = [
    prior,
    `Latest user message: ${userMessage}`,
    '',
    'Output only the JSON array.',
  ].join('\n');

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SEARCH_FORMULATION_MODEL,
      system,
      prompt,
      stream: false,
      options: { temperature: 0.15, num_predict: 320 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const text = typeof data.response === 'string' ? data.response : '';
  return parseQueriesFromModelResponse(text, userMessage);
}

export type StreamAnswerOptions = {
  /** Sub-queries passed to SearXNG (shown to the answer model for transparency). */
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
      ? `Web pages below were retrieved using these search queries: ${options.searchQueryUsed.trim()}\n\n`
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
