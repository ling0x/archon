// =============================================================================
// Search Gap Analysis
// =============================================================================

import type { PriorTurn, GapAnalysisResult } from '../../types';
import { generate } from './api';
import { SEARCH_FORMULATION_MODEL, GAP_FOLLOW_UP_MAX, MAX_SUBQUERY_LEN, OLLAMA_JSON_NUM_CTX } from './constants';
import { buildPriorBlockForFormulation } from './prior';

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  return match?.[1]?.trim() ?? trimmed;
}

function parseGapAnalysis(raw: string): GapAnalysisResult {
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

  const obj = parsed as Record<string, unknown>;
  const sufficient = Boolean(obj.sufficient);
  const fq = obj.follow_up_queries ?? obj.followUpQueries;
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

const GAP_ANALYSIS_SYSTEM = [
  'You evaluate whether web search snippets are enough to answer the user\'s question well.',
  'Reply with ONLY a JSON object, no markdown fences, no commentary.',
  '{"sufficient": boolean, "follow_up_queries": string[]}',
  `"follow_up_queries" has at most ${GAP_FOLLOW_UP_MAX} short SearXNG keyword lines (max ~${MAX_SUBQUERY_LEN} chars each).`,
  'Set sufficient to true if the snippets already cover the main facts, definitions, comparisons, or steps the user asked for.',
  'Set sufficient to false if important angles are missing (e.g. official docs, benchmarks, recent updates, named alternatives, error-specific fixes).',
  'When sufficient is false, propose targeted follow_up_queries that differ from what was already tried—fill gaps, not duplicates.',
  'When sufficient is true, follow_up_queries must be [].',
].join(' ');

/**
 * After initial search, decide if coverage is sufficient or propose follow-up queries.
 */
export async function analyzeSearchGaps(
  userMessage: string,
  priorTurns: readonly PriorTurn[],
  briefResultsSummary: string,
): Promise<GapAnalysisResult> {
  const prior = buildPriorBlockForFormulation(priorTurns);

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
    const text = await generate({
      model: SEARCH_FORMULATION_MODEL,
      system: GAP_ANALYSIS_SYSTEM,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 1024,
        num_ctx: OLLAMA_JSON_NUM_CTX,
      },
    });
    return parseGapAnalysis(text);
  } catch {
    return { sufficient: true, followUpQueries: [] };
  }
}