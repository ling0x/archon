import { defaultThinkParameter, modelSupportsThinking } from './modelCapabilities';

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
/** Wider `num_ctx` for deep-research answers; env `OLLAMA_DEEP_ANSWER_NUM_CTX`. */
const OLLAMA_DEEP_ANSWER_NUM_CTX: number = __OLLAMA_DEEP_ANSWER_NUM_CTX__;
/** Prior assistant budget when deep research is on; env `PRIOR_ASSISTANT_BUDGET_CHARS_DEEP`. */
const PRIOR_ASSISTANT_BUDGET_CHARS_DEEP: number = __PRIOR_ASSISTANT_BUDGET_CHARS_DEEP__;
/** Max follow-up queries after gap analysis; env `GAP_FOLLOW_UP_MAX`, default 2. */
const GAP_FOLLOW_UP_MAX: number = __GAP_FOLLOW_UP_MAX__;
/** `num_ctx` for single-shot JSON (gap analysis, deep plan); env `OLLAMA_JSON_NUM_CTX`. */
const OLLAMA_JSON_NUM_CTX: number = __OLLAMA_JSON_NUM_CTX__;

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
export function buildPriorBlockForAnswer(
  priorTurns: readonly PriorTurn[],
  opts?: { deepResearch?: boolean },
): string {
  const budget = opts?.deepResearch
    ? PRIOR_ASSISTANT_BUDGET_CHARS_DEEP
    : PRIOR_ASSISTANT_BUDGET_CHARS;
  return buildPriorBlockBudgeted(priorTurns, budget);
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
  const line = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return fallback;
  return line.slice(0, MAX_SUBQUERY_LEN);
}

/** Expects a raw JSON array of strings from the formulation model; otherwise uses `fallback` as a single query. */
function parseQueriesFromModelResponse(raw: string, fallback: string): string[] {
  const fb = sanitizeSearchQueryLine(fallback, fallback);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [fb];
  }
  if (!Array.isArray(parsed)) return [fb];

  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const q = sanitizeSearchQueryLine(item, '');
    if (q) out.push(q);
    if (out.length >= MAX_SUB_QUERIES) break;
  }
  const uniq = [...new Set(out)];
  return uniq.length > 0 ? uniq : [fb];
}

export type FormulationProgressHandlers = {
  onThinkingChunk?: (text: string) => void;
  onResponseChunk?: (text: string) => void;
};

/**
 * Split the user’s message (with optional prior turns) into 1–3 SearXNG sub-queries using a fixed small model.
 */
export async function formulateSearchQueries(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  progress?: FormulationProgressHandlers,
): Promise<string[]> {
  const prior = buildPriorBlockForFormulation(priorTurns);
  const system = [
    'You turn a user information need into 1–3 short SearXNG web search queries.',
    'Reply with ONLY a JSON array of strings, for example: ["postgresql docker compose volume", "nginx ssl certbot"].',
    'No markdown code fences, no object wrapper, no commentary. Maximum 3 strings.',
    'Each string must be a single line: dense search keywords and short phrases only, max about 200 characters per string.',
    'Use 1 query only when the message is narrowly about one fact, one product, or one named thing.',
    'If the message lists multiple topics, skill areas, technologies, book types, or requirements (e.g. long job specs, reading lists, or several unrelated themes), you MUST return 3 strings that cover different facets—never collapse everything into one vague query like "books to read" or "software engineering tips".',
    'Split broad asks into complementary angles: each major theme the user named should get keywords in at least one of the three strings (e.g. separate strings for distinct stacks, book genres, or problem domains they listed).',
    'The PRIMARY information need is always the latest user message. When it names a specific concept, product, error, or technical term (e.g. "read through cache", "CAP theorem"), your queries must center on that wording; do not substitute unrelated topics from earlier turns.',
    'Read the "Earlier in this conversation" block only for disambiguation or to add missing identifiers. Never let an old topic replace what the latest message explicitly asks about.',
    'When the latest message is short or vague ("that service", "is it secure", "what about ports"), resolve what they mean using prior user questions and especially prior Assistant answers, then bake those concrete terms into the search queries.',
    'When the latest message clearly introduces a new subject, prior turns are background only—at most add clarifying keywords, not a different question.',
    'If the follow-up is about something introduced in a prior Assistant answer (e.g. a docker-compose service, a library, a flag), include those identifiers in the queries so results match the same subject.',
  ].join(' ');

  const prompt = [
    'Primary question (every search string must directly serve this; repeat its key terms unless the message is only pronouns/vague references):',
    userMessage,
    '',
    prior,
    'Use earlier turns only to disambiguate or enrich the primary question above—not to ignore it.',
    'If the primary question is long or covers several subjects, output 3 queries that split those subjects; do not summarize the whole message into a single generic search.',
    '',
    'Output only the JSON array.',
  ].join('\n');

  const supportsThinking = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  const think = supportsThinking
    ? defaultThinkParameter(SEARCH_FORMULATION_MODEL)
    : undefined;

  const body: Record<string, unknown> = {
    model: SEARCH_FORMULATION_MODEL,
    system,
    prompt,
    stream: true,
    options: {
      temperature: 0.15,
      num_predict: 512,
      num_ctx: SEARCH_FORMULATION_NUM_CTX,
    },
  };
  if (think !== undefined) body.think = think;

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
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        if (chunk.thinking) {
          progress?.onThinkingChunk?.(chunk.thinking);
        }
        if (chunk.response) {
          text += chunk.response;
          progress?.onResponseChunk?.(chunk.response);
        }
        if (chunk.done) return parseQueriesFromModelResponse(text, userMessage);
      } catch {
        // skip malformed lines
      }
    }
  }

  return parseQueriesFromModelResponse(text, userMessage);
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  return m?.[1]?.trim() ?? t;
}

async function ollamaGenerateNonStream(
  model: string,
  system: string,
  prompt: string,
  numCtx: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    system,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      num_predict: 1024,
      num_ctx: numCtx,
    },
  };

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { response?: string };
  return typeof data.response === 'string' ? data.response : '';
}

export type GapAnalysisResult = {
  sufficient: boolean;
  /** 0–GAP_FOLLOW_UP_MAX follow-up SearXNG queries. */
  followUpQueries: string[];
};

function parseGapAnalysisJson(raw: string): GapAnalysisResult {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { sufficient: true, followUpQueries: [] };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { sufficient: true, followUpQueries: [] };
  }
  const o = parsed as Record<string, unknown>;
  const sufficient = Boolean(o.sufficient);
  const fq = o.follow_up_queries ?? o.followUpQueries;
  const out: string[] = [];
  if (Array.isArray(fq)) {
    for (const item of fq) {
      if (typeof item !== 'string') continue;
      const q = item.trim().split(/\r?\n/)[0]?.trim() ?? '';
      if (q) out.push(q.slice(0, MAX_SUBQUERY_LEN));
      if (out.length >= GAP_FOLLOW_UP_MAX) break;
    }
  }
  return { sufficient, followUpQueries: [...new Set(out)] };
}

/**
 * After an initial search, decide whether coverage is enough or propose follow-up queries.
 */
export async function analyzeSearchGaps(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  briefResultsSummary: string,
): Promise<GapAnalysisResult> {
  const prior = buildPriorBlockForFormulation(priorTurns);
  const system = [
    'You evaluate whether web search snippets are enough to answer the user’s question well.',
    `Reply with ONLY a JSON object, no markdown fences, no commentary.`,
    `Schema: {"sufficient": boolean, "follow_up_queries": string[]}`,
    `"follow_up_queries" has at most ${GAP_FOLLOW_UP_MAX} short SearXNG keyword lines (max ~${MAX_SUBQUERY_LEN} chars each).`,
    'Set sufficient to true if the snippets already cover the main facts, definitions, comparisons, or steps the user asked for.',
    'Set sufficient to false if important angles are missing (e.g. official docs, benchmarks, recent updates, named alternatives, error-specific fixes).',
    'When sufficient is false, propose targeted follow_up_queries that differ from what was already tried—fill gaps, not duplicates.',
    'When sufficient is true, follow_up_queries must be [].',
  ].join(' ');

  const prompt = [
    'User question:',
    userMessage,
    '',
    prior,
    '--- Snippets from current search (titles + excerpts) ---',
    briefResultsSummary.trim() || '(No snippets.)',
    '--- End snippets ---',
    '',
    'Output only the JSON object.',
  ].join('\n');

  try {
    const text = await ollamaGenerateNonStream(
      SEARCH_FORMULATION_MODEL,
      system,
      prompt,
      OLLAMA_JSON_NUM_CTX,
    );
    return parseGapAnalysisJson(text);
  } catch {
    return { sufficient: true, followUpQueries: [] };
  }
}

export type DeepResearchPlanResult = {
  plan: string[];
  queries: string[];
};

function parseDeepPlanJson(raw: string, userMessage: string): DeepResearchPlanResult {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { plan: [], queries: [] };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { plan: [], queries: [] };
  }
  const o = parsed as Record<string, unknown>;
  const planRaw = o.plan;
  const plan: string[] = [];
  if (Array.isArray(planRaw)) {
    for (const item of planRaw) {
      if (typeof item !== 'string') continue;
      const s = item.trim();
      if (s) plan.push(s.slice(0, 500));
      if (plan.length >= 8) break;
    }
  }
  const qRaw = o.queries;
  const queries: string[] = [];
  if (Array.isArray(qRaw)) {
    for (const item of qRaw) {
      if (typeof item !== 'string') continue;
      const q = item.trim().split(/\r?\n/)[0]?.trim() ?? '';
      if (q) queries.push(q.slice(0, MAX_SUBQUERY_LEN));
      if (queries.length >= MAX_SUB_QUERIES) break;
    }
  }
  const uniqQ = [...new Set(queries)];
  if (uniqQ.length === 0) {
    return { plan, queries: [sanitizeSearchQueryLine(userMessage, userMessage)] };
  }
  return { plan, queries: uniqQ };
}

/**
 * Deep mode: structured research plan plus 1–3 search queries in one JSON object.
 */
export async function formulateDeepResearchPlanAndQueries(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  progress?: FormulationProgressHandlers,
): Promise<DeepResearchPlanResult> {
  const prior = buildPriorBlockForFormulation(priorTurns);
  const system = [
    'You design a short research plan and SearXNG web search queries for the user’s question.',
    'Reply with ONLY a JSON object (no markdown fences):',
    '{"plan": string[], "queries": string[]}',
    '"plan": 2–6 concise bullet strings (sub-questions or sections to cover).',
    '"queries": 1–3 short keyword lines for SearXNG (max ~200 chars each), same rules as standard multi-query search.',
    'Plans should reflect distinct facets; queries should map to those facets without overlapping generic phrasing.',
    'The PRIMARY need is the latest user message; use earlier conversation only to disambiguate.',
  ].join(' ');

  const prompt = [
    'Primary question:',
    userMessage,
    '',
    prior,
    'Output only the JSON object.',
  ].join('\n');

  const supportsThinking = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  const think = supportsThinking
    ? defaultThinkParameter(SEARCH_FORMULATION_MODEL)
    : undefined;

  const body: Record<string, unknown> = {
    model: SEARCH_FORMULATION_MODEL,
    system,
    prompt,
    stream: true,
    options: {
      temperature: 0.15,
      num_predict: 900,
      num_ctx: SEARCH_FORMULATION_NUM_CTX,
    },
  };
  if (think !== undefined) body.think = think;

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
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        if (chunk.thinking) {
          progress?.onThinkingChunk?.(chunk.thinking);
        }
        if (chunk.response) {
          text += chunk.response;
          progress?.onResponseChunk?.(chunk.response);
        }
        if (chunk.done) {
          const parsed = parseDeepPlanJson(text, userMessage);
          if (parsed.queries.length > 0) return parsed;
          const fb = await formulateSearchQueries(userMessage, priorTurns, progress);
          return { plan: parsed.plan.length > 0 ? parsed.plan : ['Search and synthesize'], queries: fb };
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const parsed = parseDeepPlanJson(text, userMessage);
  if (parsed.queries.length > 0) return parsed;
  const fb = await formulateSearchQueries(userMessage, priorTurns, progress);
  return { plan: parsed.plan, queries: fb };
}

const SYSTEM_RESEARCH_NOTES = [
  'You extract structured bullet notes for a researcher. This is pass 1 of 2 — notes only, not a polished article.',
  'Use ONLY the numbered web excerpts below. Every substantive bullet must cite at least one source with [[n]] matching the bracket number.',
  'No introduction or conclusion prose; bullets and short sub-bullets only.',
  'If excerpts conflict, note both with citations.',
  'If something is missing from excerpts, write one bullet stating what is missing — do not invent facts.',
].join(' ');

/**
 * Pass A of two-pass deep research: bullet notes with [[n]] citations.
 */
export async function* streamOllamaResearchNotes(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: { think?: boolean | 'low' | 'medium' | 'high'; deepResearch?: boolean },
): AsyncGenerator<StreamAnswerChunk> {
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

  const numCtx =
    options.deepResearch === true ? OLLAMA_DEEP_ANSWER_NUM_CTX : OLLAMA_ANSWER_NUM_CTX;

  const body: Record<string, unknown> = {
    model,
    system: SYSTEM_RESEARCH_NOTES,
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

export type StreamAnswerOptions = {
  hasSearchResults: boolean;
  searchQueryUsed?: string;
  /** Ollama `think` when the model supports it; omit for models without thinking. */
  think?: boolean | 'low' | 'medium' | 'high';
  /** Wider prior budget + context when true. */
  deepResearch?: boolean;
  /** Pass B: draft notes from `streamOllamaResearchNotes`. */
  intermediateResearchNotes?: string;
  /** When true with `intermediateResearchNotes`, use synthesis prompt and integrate notes + excerpts. */
  twoPassSynthesis?: boolean;
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

const SYSTEM_PROMPT_TWO_PASS = [
  'You synthesize a clear, well-organized answer using (1) draft research notes from an earlier pass and (2) the numbered web search excerpts below.',
  'Treat excerpts as authoritative for facts; if notes and excerpts disagree, follow excerpts and cite with [[n]].',
  'Ground non-obvious factual claims in excerpts with [[n]] citations; use only indices that exist.',
  'You may reorganize and polish wording; do not introduce new factual claims without excerpt support.',
  'The block labeled "Earlier in this conversation" may be truncated; use it when the user refers to prior replies.',
].join(' ');

export async function* streamOllamaAnswer(
  query: string,
  searchContext: string,
  priorTurns: readonly PriorTurn[],
  model: string,
  options: StreamAnswerOptions,
): AsyncGenerator<StreamAnswerChunk> {
  const hasSearch = options.hasSearchResults;
  const twoPass =
    Boolean(options.twoPassSynthesis && options.intermediateResearchNotes?.trim()) && hasSearch;
  const systemPrompt = hasSearch
    ? twoPass
      ? SYSTEM_PROMPT_TWO_PASS
      : SYSTEM_PROMPT_GROUNDED
    : SYSTEM_PROMPT_NO_RESULTS;

  const prior = buildPriorBlockForAnswer(priorTurns, { deepResearch: options.deepResearch });

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

  const draftNotes = options.intermediateResearchNotes?.trim() ?? '';
  const draftBlock =
    twoPass && draftNotes.length > 0
      ? [
          '--- Draft research notes (pass 1) ---',
          draftNotes,
          '--- End draft notes ---',
          '',
        ].join('\n')
      : '';

  const userMessage = [
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

  const answerNumCtx =
    options.deepResearch === true ? OLLAMA_DEEP_ANSWER_NUM_CTX : OLLAMA_ANSWER_NUM_CTX;

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    prompt: userMessage,
    stream: true,
    options: {
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.05,
      num_ctx: answerNumCtx,
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
