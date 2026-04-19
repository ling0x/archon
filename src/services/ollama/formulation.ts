// =============================================================================
// Search Query Formulation
// =============================================================================

import type { PriorTurn, FormulationProgressHandlers } from '../../types';
import { streamGenerate } from './api';
import {
  SEARCH_FORMULATION_MODEL,
  SEARCH_FORMULATION_NUM_CTX,
  MAX_SUB_QUERIES,
  MAX_SUBQUERY_LEN,
} from './constants';
import { buildPriorBlockForFormulation } from './prior';
import { defaultThinkParameter, modelSupportsThinking } from '../../modelCapabilities';

function sanitizeQueryLine(raw: string, fallback: string): string {
  const line = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return line ? line.slice(0, MAX_SUBQUERY_LEN) : fallback;
}

function parseQueriesFromResponse(raw: string, fallback: string): string[] {
  const fb = sanitizeQueryLine(fallback, fallback);
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
    const q = sanitizeQueryLine(item, '');
    if (q) out.push(q);
    if (out.length >= MAX_SUB_QUERIES) break;
  }

  const unique = [...new Set(out)];
  return unique.length > 0 ? unique : [fb];
}

const FORMULATION_SYSTEM = [
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

export async function formulateSearchQueries(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  progress?: FormulationProgressHandlers,
): Promise<string[]> {
  const prior = buildPriorBlockForFormulation(priorTurns);

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
  const think = supportsThinking ? defaultThinkParameter(SEARCH_FORMULATION_MODEL) : undefined;

  const body: Record<string, unknown> = {
    model: SEARCH_FORMULATION_MODEL,
    system: FORMULATION_SYSTEM,
    prompt,
    stream: true,
    options: {
      temperature: 0.15,
      num_predict: 512,
      num_ctx: SEARCH_FORMULATION_NUM_CTX,
    },
  };
  if (think !== undefined) body.think = think;

  let text = '';
  for await (const chunk of streamGenerate(body)) {
    if (chunk.thinking) {
      progress?.onThinkingChunk?.(chunk.thinking);
    }
    if (chunk.response) {
      text += chunk.response;
      progress?.onResponseChunk?.(chunk.response);
    }
    if (chunk.done) {
      return parseQueriesFromResponse(text, userMessage);
    }
  }

  return parseQueriesFromResponse(text, userMessage);
}