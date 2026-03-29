export interface OllamaStreamChunk {
  model: string;
  response: string;
  done: boolean;
}

export type PriorTurn = { query: string; answer: string };

/** Keeps follow-ups from anchoring on long prior answers; formulation uses `buildPriorBlock`. */
const PRIOR_ANSWER_TRUNCATE_CHARS = 480;

function wrapPriorConversationBlock(body: string): string {
  return [
    '--- Earlier in this conversation ---',
    body,
    '--- End earlier conversation ---',
    '',
  ].join('\n');
}

/** Full prior turns for search-query formulation. */
export function buildPriorBlock(priorTurns: readonly PriorTurn[]): string {
  if (priorTurns.length === 0) return '';
  const body = priorTurns
    .map(
      (t, i) => `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${t.answer}`,
    )
    .join('\n\n');
  return wrapPriorConversationBlock(body);
}

/** Truncated prior turns for the answer model only. */
function buildPriorBlockTruncated(priorTurns: readonly PriorTurn[]): string {
  if (priorTurns.length === 0) return '';
  const body = priorTurns
    .map((t, i) => {
      let ans = t.answer;
      if (ans.length > PRIOR_ANSWER_TRUNCATE_CHARS) {
        ans = `${ans.slice(0, PRIOR_ANSWER_TRUNCATE_CHARS).trimEnd()}…`;
      }
      return `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${ans}`;
    })
    .join('\n\n');
  return wrapPriorConversationBlock(body);
}

/** Model dedicated to turning user intent into SearXNG sub-queries (not the answer model). */
export const SEARCH_FORMULATION_MODEL: string = __SEARCH_FORMULATION_MODEL__;

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
  hasSearchResults: boolean;
  searchQueryUsed?: string;
};

const SYSTEM_PROMPT_GROUNDED = [
  'You are a careful assistant that answers using the numbered web search excerpts below.',
  'Ground every non-obvious factual claim in those excerpts; after each such claim, cite the source index with [[n]] (e.g. [[2]]) matching the bracket number shown before each result.',
  'Use only citation indices that exist in the excerpt list; never invent [[n]] numbers or URLs not listed.',
  'If excerpts conflict, say so briefly and reflect both sides or explain the uncertainty.',
  'If excerpts are insufficient for the question, say so clearly instead of guessing.',
  'Earlier conversation turns may be truncated; they are for context only. If anything there disagrees with the excerpts for the current question, trust the excerpts.',
].join(' ');

const SYSTEM_PROMPT_NO_RESULTS = [
  'No web search results were retrieved for this question.',
  'Do not invent specific facts, statistics, dates, quotes, or URLs as if they came from the web.',
  'Briefly explain that nothing was found, suggest rephrasing or different keywords, and only then offer very general non-specific guidance if helpful.',
].join(' ');

export async function* streamOllamaAnswer(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: StreamAnswerOptions,
): AsyncGenerator<string> {
  const hasSearch = options.hasSearchResults;
  const systemPrompt = hasSearch ? SYSTEM_PROMPT_GROUNDED : SYSTEM_PROMPT_NO_RESULTS;

  const prior = buildPriorBlockTruncated(priorTurns);

  const sq = options.searchQueryUsed?.trim() ?? '';
  const searchQueryNote =
    sq.length === 0
      ? ''
      : hasSearch
        ? `Web pages below were retrieved using these search queries: ${sq}\n\n`
        : `Web search was attempted (no results) with: ${sq}\n\n`;

  const resultsBody = hasSearch
    ? searchContext.trim().length > 0
      ? searchContext
      : '(No excerpt text was returned for the retrieved URLs.)'
    : '(No pages were retrieved — the search returned zero results.)';

  const userMessage = [
    prior,
    searchQueryNote,
    `Current question: ${query}`,
    '',
    '--- Search Results ---',
    resultsBody,
    '--- End of Search Results ---',
    '',
    hasSearch
      ? 'Answer the current question using the search results above, with [[n]] citations as specified.'
      : 'Follow the instructions for the no-results case.',
  ].join('\n');

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      prompt: userMessage,
      stream: true,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        repeat_penalty: 1.05,
        num_ctx: 8192,
      },
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
