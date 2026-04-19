// =============================================================================
// Deep Research Formulation
// =============================================================================

import type { PriorTurn, DeepResearchPlanResult, FormulationProgressHandlers, StreamChunk } from '../../types';
import { streamGenerate } from './api';
import {
  SEARCH_FORMULATION_MODEL,
  SEARCH_FORMULATION_NUM_CTX,
  MAX_SUBQUERY_LEN,
  MAX_SUB_QUERIES,
} from './constants';
import { buildPriorBlockForFormulation } from './prior';
import { defaultThinkParameter, modelSupportsThinking } from '../../modelCapabilities';
import { formulateSearchQueries } from './formulation';

function sanitizeQueryLine(raw: string, fallback: string): string {
  const line = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return line ? line.slice(0, MAX_SUBQUERY_LEN) : fallback;
}

function parseDeepPlan(raw: string, userMessage: string): DeepResearchPlanResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { plan: [], queries: [] };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { plan: [], queries: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const plan: string[] = [];
  const planRaw = obj.plan;

  if (Array.isArray(planRaw)) {
    for (const item of planRaw) {
      if (typeof item !== 'string') continue;
      const s = item.trim();
      if (s) plan.push(s.slice(0, 500));
      if (plan.length >= 8) break;
    }
  }

  const queriesRaw = obj.queries;
  const queries: string[] = [];
  if (Array.isArray(queriesRaw)) {
    for (const item of queriesRaw) {
      if (typeof item !== 'string') continue;
      const q = item.trim().split(/\r?\n/)[0]?.trim() ?? '';
      if (q) queries.push(q.slice(0, MAX_SUBQUERY_LEN));
      if (queries.length >= MAX_SUB_QUERIES) break;
    }
  }

  const uniqueQueries = [...new Set(queries)];
  if (uniqueQueries.length === 0) {
    return { plan, queries: [sanitizeQueryLine(userMessage, userMessage)] };
  }

  return { plan, queries: uniqueQueries };
}

const DEEP_PLAN_SYSTEM = [
  'You design a short research plan and SearXNG web search queries for the user\'s question.',
  'Reply with ONLY a JSON object (no markdown fences):',
  '{"plan": string[], "queries": string[]}',
  '"plan": 2–6 concise bullet strings (sub-questions or sections to cover).',
  '"queries": 1–3 short keyword lines for SearXNG (max ~200 chars each).',
  'Plans should reflect distinct facets; queries should map to those facets without overlapping generic phrasing.',
  'The PRIMARY need is the latest user message; use earlier conversation only to disambiguate.',
].join(' ');

/**
 * Deep mode: structured research plan plus 1–3 search queries.
 */
export async function formulateDeepResearchPlanAndQueries(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  progress?: FormulationProgressHandlers,
): Promise<DeepResearchPlanResult> {
  const prior = buildPriorBlockForFormulation(priorTurns);

  const prompt = [
    'Primary question:',
    userMessage,
    '',
    prior,
    'Output only the JSON object.',
  ].join('\n');

  const supportsThinking = await modelSupportsThinking(SEARCH_FORMULATION_MODEL);
  const think = supportsThinking ? defaultThinkParameter(SEARCH_FORMULATION_MODEL) : undefined;

  const body: Record<string, unknown> = {
    model: SEARCH_FORMULATION_MODEL,
    system: DEEP_PLAN_SYSTEM,
    prompt,
    stream: true,
    options: {
      temperature: 0.15,
      num_predict: 900,
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
      const parsed = parseDeepPlan(text, userMessage);
      if (parsed.queries.length > 0) return parsed;
      const fallback = await formulateSearchQueries(userMessage, priorTurns, progress);
      return {
        plan: parsed.plan.length > 0 ? parsed.plan : ['Search and synthesize'],
        queries: fallback,
      };
    }
  }

  const parsed = parseDeepPlan(text, userMessage);
  if (parsed.queries.length > 0) return parsed;
  const fallback = await formulateSearchQueries(userMessage, priorTurns, progress);
  return { plan: parsed.plan, queries: fallback };
}