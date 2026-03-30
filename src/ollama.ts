export interface OllamaStreamChunk {
  model: string;
  response: string;
  thinking?: string;
  done: boolean;
}

export type StreamAnswerChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'response'; text: string };

export type PriorTurn = { query: string; answer: string };

/**
 * Max characters of prior *assistant* answers included in the answer prompt, allocated
 * newest-turn-first so the latest reply (e.g. a docker-compose example) stays intact.
 * Override with env `PRIOR_ASSISTANT_BUDGET_CHARS` (default 6000; baked in at build via Vite).
 */
const PRIOR_ASSISTANT_BUDGET_CHARS: number = __PRIOR_ASSISTANT_BUDGET_CHARS__;
/** Ollama `num_ctx` for streaming answers; env `OLLAMA_ANSWER_NUM_CTX`, default 16384. */
const OLLAMA_ANSWER_NUM_CTX: number = __OLLAMA_ANSWER_NUM_CTX__;
/** Prior assistant budget for search-query formulation; env `SEARCH_FORMULATION_PRIOR_BUDGET_CHARS`, default 10000. */
const SEARCH_FORMULATION_PRIOR_BUDGET_CHARS: number =
  __SEARCH_FORMULATION_PRIOR_BUDGET_CHARS__;
/** Ollama `num_ctx` for the search-formulation request; env `SEARCH_FORMULATION_NUM_CTX`, default 16384. */
const SEARCH_FORMULATION_NUM_CTX: number = __SEARCH_FORMULATION_NUM_CTX__;

function wrapPriorConversationBlock(body: string): string {
  return [
    '--- Earlier in this conversation ---',
    body,
    '--- End earlier conversation ---',
    '',
  ].join('\n');
}

/** Full prior turns (no truncation). Prefer budgeted blocks for prompts that must fit `num_ctx`. */
export function buildPriorBlock(priorTurns: readonly PriorTurn[]): string {
  if (priorTurns.length === 0) return '';
  const body = priorTurns
    .map(
      (t, i) => `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${t.answer}`,
    )
    .join('\n\n');
  return wrapPriorConversationBlock(body);
}

function buildPriorBlockBudgeted(
  priorTurns: readonly PriorTurn[],
  assistantAnswerBudget: number,
): string {
  if (priorTurns.length === 0) return '';
  const answers = allocatePriorAnswersNewestFirst(
    priorTurns,
    assistantAnswerBudget,
  );
  const body = priorTurns
    .map((t, i) => `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${answers[i]}`)
    .join('\n\n');
  return wrapPriorConversationBlock(body);
}

/** Allocate assistant-answer text newest-first so follow-ups about the last reply stay coherent. */
function allocatePriorAnswersNewestFirst(
  priorTurns: readonly PriorTurn[],
  budget: number,
): string[] {
  const n = priorTurns.length;
  const out: string[] = Array.from({ length: n }, () => '');
  let remaining = Math.max(0, budget);
  for (let i = n - 1; i >= 0; i--) {
    const raw = priorTurns[i].answer;
    if (raw.length <= remaining) {
      out[i] = raw;
      remaining -= raw.length;
    } else if (remaining > 0) {
      out[i] = `${raw.slice(0, remaining).trimEnd()}…`;
      remaining = 0;
    } else {
      out[i] = '[Earlier assistant reply omitted here to fit context limits.]';
    }
  }
  return out;
}

/** Prior turns for the answer model: budgeted, newest assistant replies preserved. */
function buildPriorBlockForAnswer(priorTurns: readonly PriorTurn[]): string {
  return buildPriorBlockBudgeted(priorTurns, PRIOR_ASSISTANT_BUDGET_CHARS);
}

/** Prior turns for search-query formulation: larger budget, newest replies preserved for follow-ups. */
function buildPriorBlockForFormulation(priorTurns: readonly PriorTurn[]): string {
  return buildPriorBlockBudgeted(priorTurns, SEARCH_FORMULATION_PRIOR_BUDGET_CHARS);
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
  const prior = buildPriorBlockForFormulation(priorTurns);
  const system = [
    'You turn a user information need into 1–3 short SearXNG web search queries.',
    'Reply with ONLY a JSON array of strings, for example: ["postgresql docker compose volume", "nginx ssl certbot"].',
    'No markdown code fences, no object wrapper, no commentary. Maximum 3 strings.',
    'Each string must be a single line: search keywords and short phrases only, under 120 characters.',
    'If one query is enough, return a one-element array.',
    'Read the entire "Earlier in this conversation" block. Assistant replies often name products, versions, images, APIs, errors, file formats, or topics.',
    'When the latest user message is short or vague ("that service", "is it secure", "what about ports"), resolve what they mean using the prior user questions and especially the prior Assistant answers, then bake those concrete terms into the search queries.',
    'If the follow-up is about something introduced in a prior Assistant answer (e.g. a docker-compose service, a library, a flag), include those identifiers in the queries so results match the same subject.',
  ].join(' ');

  const prompt = [
    prior,
    'Use the conversation above so the queries match the same topic as the latest message.',
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
      options: {
        temperature: 0.15,
        num_predict: 320,
        num_ctx: SEARCH_FORMULATION_NUM_CTX,
      },
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
  /** Ollama `think` when the model supports it; omit for models without thinking. */
  think?: boolean | 'low' | 'medium' | 'high';
};

const SYSTEM_PROMPT_GROUNDED = [
  'You are a careful assistant that answers using the numbered web search excerpts below.',
  'Ground every non-obvious factual claim in those excerpts; after each such claim, cite the source index with [[n]] (e.g. [[2]]) matching the bracket number shown before each result.',
  'Use only citation indices that exist in the excerpt list; never invent [[n]] numbers or URLs not listed.',
  'If excerpts conflict, say so briefly and reflect both sides or explain the uncertainty.',
  'If excerpts are insufficient for the question, say so clearly instead of guessing.',
  'The block labeled "Earlier in this conversation" may be truncated for length; use it when the user refers to your prior replies, code, or examples (e.g. YAML, commands).',
  'For questions about content you already gave in that block, answer from that earlier assistant text; no [[n]] citation is required for your own prior wording.',
  'For new factual claims about the external world, rely on the search excerpts below; if earlier conversation and excerpts conflict on web-sourced facts, prefer the excerpts.',
].join(' ');

const SYSTEM_PROMPT_NO_RESULTS = [
  'No web search results were retrieved for this question.',
  'Do not invent specific facts, statistics, dates, quotes, or URLs as if they came from the web.',
  'Briefly explain that nothing was found, suggest rephrasing or different keywords, and only then offer very general non-specific guidance if helpful.',
  'If the user asks about code, YAML, or explanations from "Earlier in this conversation", answer from that block when it contains the material.',
].join(' ');

export async function* streamOllamaAnswer(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: StreamAnswerOptions,
): AsyncGenerator<StreamAnswerChunk> {
  const hasSearch = options.hasSearchResults;
  const systemPrompt = hasSearch ? SYSTEM_PROMPT_GROUNDED : SYSTEM_PROMPT_NO_RESULTS;

  const prior = buildPriorBlockForAnswer(priorTurns);

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

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    prompt: userMessage,
    stream: true,
    options: {
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.05,
      num_ctx: OLLAMA_ANSWER_NUM_CTX,
    },
  };
  if (options.think !== undefined) {
    body.think = options.think;
  }

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
        if (chunk.thinking) {
          yield { kind: 'thinking', text: chunk.thinking };
        }
        if (chunk.response) {
          yield { kind: 'response', text: chunk.response };
        }
        if (chunk.done) return;
      } catch {
        // skip malformed lines
      }
    }
  }
}
