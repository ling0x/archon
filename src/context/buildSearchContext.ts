import type { SearchResult } from '../searxng';

export function buildSearchContext(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');
}
