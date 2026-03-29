export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export async function searchSearXNG(query: string, numResults = 8): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'en',
  });

  const res = await fetch(`/searxng/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`SearXNG error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results as any[])
    .slice(0, numResults)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? r.snippet ?? '',
    }));
}

/** First occurrence wins; compares normalized URLs. */
export function dedupeSearchResultsByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export type SearchSearXNGMultiOptions = {
  /** Max hits per sub-query (default 8). */
  perQuery?: number;
  /** Cap after deduping (default 16). */
  maxTotal?: number;
};

/**
 * Run up to 3 distinct queries in parallel, merge and dedupe by URL, then truncate to maxTotal.
 * Failed sub-queries yield no hits for that line only.
 */
export async function searchSearXNGMulti(
  queries: readonly string[],
  opts?: SearchSearXNGMultiOptions,
): Promise<SearchResult[]> {
  const perQuery = opts?.perQuery ?? 8;
  const maxTotal = opts?.maxTotal ?? 16;
  const normalized = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
  if (normalized.length === 0) return [];

  const batches = await Promise.all(
    normalized.map(async (q) => {
      try {
        return await searchSearXNG(q, perQuery);
      } catch {
        return [];
      }
    }),
  );

  return dedupeSearchResultsByUrl(batches.flat()).slice(0, maxTotal);
}
