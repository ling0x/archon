// =============================================================================
// Prior Conversation Block Building
// =============================================================================

import type { PriorTurn } from '../../types';
import {
  PRIOR_ASSISTANT_BUDGET_CHARS,
  PRIOR_ASSISTANT_BUDGET_CHARS_DEEP,
  SEARCH_FORMULATION_PRIOR_BUDGET_CHARS,
} from './constants';

const WRAPPER_BLOCK = [
  '--- Earlier in this conversation ---',
  '{body}',
  '--- End earlier conversation ---',
  '',
].join('\n');

function wrapPriorConversation(body: string): string {
  return WRAPPER_BLOCK.replace('{body}', body);
}

/**
 * Build full prior turns block without truncation.
 * Prefer budgeted blocks for prompts that must fit num_ctx.
 */
export function buildPriorBlock(priorTurns: readonly PriorTurn[]): string {
  if (priorTurns.length === 0) return '';

  const body = priorTurns
    .map((t, i) => `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${t.answer}`)
    .join('\n\n');

  return wrapPriorConversation(body);
}

/**
 * Build budgeted prior block (newest-first allocation).
 * Latest assistant replies are preserved, earlier ones truncated.
 */
function buildPriorBlockBudgeted(
  priorTurns: readonly PriorTurn[],
  budget: number,
): string {
  if (priorTurns.length === 0) return '';

  const answers = allocatePriorAnswersNewestFirst(priorTurns, budget);
  const body = priorTurns
    .map((t, i) => `Turn ${i + 1}\nUser: ${t.query}\nAssistant: ${answers[i]}`)
    .join('\n\n');

  return wrapPriorConversation(body);
}

/**
 * Allocate assistant-answer text newest-first.
 * Latest replies (like docker-compose examples) stay intact.
 */
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

/** Prior turns for answer model (budgeted, newest preserved). */
export function buildPriorBlockForAnswer(
  priorTurns: readonly PriorTurn[],
  opts?: { deepResearch?: boolean },
): string {
  const budget = opts?.deepResearch
    ? PRIOR_ASSISTANT_BUDGET_CHARS_DEEP
    : PRIOR_ASSISTANT_BUDGET_CHARS;

  return buildPriorBlockBudgeted(priorTurns, budget);
}

/** Prior turns for search query formulation (larger budget). */
export function buildPriorBlockForFormulation(priorTurns: readonly PriorTurn[]): string {
  return buildPriorBlockBudgeted(priorTurns, SEARCH_FORMULATION_PRIOR_BUDGET_CHARS);
}