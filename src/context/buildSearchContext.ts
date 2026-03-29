import type { SearchResult } from '../searxng';

function formatResultBlock(r: SearchResult, indexOneBased: number): string {
  const lines = [
    `[${indexOneBased}] ${r.title}`,
    `URL: ${r.url}`,
  ];
  if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`);
  if (r.engine) lines.push(`Engine: ${r.engine}`);
  lines.push(r.content);
  return lines.join('\n');
}

export function buildSearchContext(results: SearchResult[]): string {
  return results.map((r, i) => formatResultBlock(r, i + 1)).join('\n\n');
}
