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

/**
 * Take up to one new hit per batch per round (q0 → q1 → q2 → …), skipping duplicate URLs,
 * until maxTotal or all batches are exhausted. Gives even representation across sub-queries
 * when each returns distinct URLs.
 */
function mergeSearchResultsRoundRobin(
  batches: readonly (readonly SearchResult[])[],
  maxTotal: number,
): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  const nextIdx = batches.map(() => 0);

  while (out.length < maxTotal) {
    let progressed = false;
    for (let i = 0; i < batches.length && out.length < maxTotal; i++) {
      const batch = batches[i]!;
      let idx = nextIdx[i]!;
      while (idx < batch.length) {
        const r = batch[idx]!;
        idx++;
        nextIdx[i] = idx;
        const key = r.url.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(r);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
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
 * Run up to 3 distinct queries in parallel, merge with round-robin dedupe by URL, cap at maxTotal.
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

  return mergeSearchResultsRoundRobin(batches, maxTotal);
}
