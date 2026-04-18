import type { SearchResult } from '../searxng';

function formatResultBlock(
  r: SearchResult,
  indexOneBased: number,
  extractedByUrl?: ReadonlyMap<string, string>,
): string {
  const lines = [
    `[${indexOneBased}] ${r.title}`,
    `URL: ${r.url}`,
  ];
  if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`);
  if (r.engine) lines.push(`Engine: ${r.engine}`);
  lines.push(r.content);
  const key = r.url.trim();
  const full = key && extractedByUrl?.get(key);
  if (full?.trim()) {
    lines.push('--- Extracted page text (may be truncated) ---');
    lines.push(full.trim());
  }
  return lines.join('\n');
}

export function buildSearchContext(
  results: SearchResult[],
  extractedByUrl?: ReadonlyMap<string, string>,
): string {
  return results.map((r, i) => formatResultBlock(r, i + 1, extractedByUrl)).join('\n\n');
}
