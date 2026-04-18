export interface SearchResult {
  title: string;
  url: string;
  content: string;
  /** ISO-like date string when the engine provides it (recency for the model). */
  publishedDate?: string;
  /** SearXNG backend that returned this hit (provenance). */
  engine?: string;
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
  return (data.results as any[]).slice(0, numResults).map(parseSearxResultRow);
}

function pickOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Normalize one SearXNG JSON result row (field names vary slightly by engine). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSearxResultRow(r: any): SearchResult {
  const publishedDate = pickOptionalString(r.publishedDate);
  const engine = pickOptionalString(r.engine);

  const rawContent = typeof r.content === 'string' ? r.content.trim() : '';
  const rawSnippet = typeof r.snippet === 'string' ? r.snippet.trim() : '';
  const content = rawContent.length > 0 ? rawContent : rawSnippet;

  return {
    title: typeof r.title === 'string' ? r.title : '',
    url: typeof r.url === 'string' ? r.url : '',
    content,
    ...(publishedDate !== undefined ? { publishedDate } : {}),
    ...(engine !== undefined ? { engine } : {}),
  };
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

/** RRF constant; common default in fusion literature (e.g. Cormack et al.). */
const RRF_K = 60;

/**
 * Merge ranked result lists from parallel queries: dedupe by URL, score each URL with
 * reciprocal rank fusion (sum of 1/(k + rank) per list it appears in), then take the
 * top maxTotal. For a URL that appears in multiple lists, keeps title/snippet from the
 * list where it ranked highest (lowest 1-based rank).
 */
/**
 * Merge any number of ranked result lists with reciprocal rank fusion (RRF),
 * dedupe by URL, return top `maxTotal`. Use to combine multi-round search batches.
 */
export function mergeRankedSearchResultLists(
  batches: readonly (readonly SearchResult[])[],
  maxTotal: number,
): SearchResult[] {
  type Acc = { score: number; bestRank: number; result: SearchResult };
  const byUrl = new Map<string, Acc>();

  for (const batch of batches) {
    for (let j = 0; j < batch.length; j++) {
      const r = batch[j]!;
      const key = r.url.trim().toLowerCase();
      if (!key) continue;

      const rank = j + 1;
      const contrib = 1 / (RRF_K + rank);
      const cur = byUrl.get(key);

      if (!cur) {
        byUrl.set(key, { score: contrib, bestRank: rank, result: r });
      } else {
        cur.score += contrib;
        if (rank < cur.bestRank) {
          cur.bestRank = rank;
          cur.result = r;
        }
      }
    }
  }

  const merged = [...byUrl.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.bestRank - b.bestRank;
  });

  return merged.slice(0, maxTotal).map((x) => x.result);
}

export type SearchSearXNGMultiOptions = {
  /** Max hits per sub-query (default 8). */
  perQuery?: number;
  /** Cap after deduping (default 16). */
  maxTotal?: number;
};

/**
 * Run up to 3 distinct queries in parallel (up to perQuery hits each), merge all hits with
 * global RRF ranking and dedupe by URL, then return the top maxTotal.
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

  return mergeRankedSearchResultLists(batches, maxTotal);
}
