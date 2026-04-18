import type { SearchResult } from '../searxng';

const MAX_SNIPPET_CHARS = 420;

/**
 * Compact titles + snippets for gap-analysis prompts (no full extracted text).
 */
export function buildBriefSearchSummaryForGap(
  results: readonly SearchResult[],
  maxItems = 14,
): string {
  const lines: string[] = [];
  const n = Math.min(results.length, maxItems);
  for (let i = 0; i < n; i++) {
    const r = results[i]!;
    const snip =
      r.content.length > MAX_SNIPPET_CHARS
        ? `${r.content.slice(0, MAX_SNIPPET_CHARS)}…`
        : r.content;
    lines.push(`[${i + 1}] ${r.title}\nURL: ${r.url}\n${snip}`);
  }
  if (results.length > maxItems) {
    lines.push(`… and ${results.length - maxItems} more results not shown.`);
  }
  return lines.join('\n\n');
}
