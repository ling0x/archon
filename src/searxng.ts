// =============================================================================
// SearXNG Search Service
// =============================================================================

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  engine?: string;
}

// RRF constant from fusion literature
const RRF_K = 60;

/** Search SearXNG for a single query. */
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

/** Dedupe search results by URL (case-insensitive). */
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

/** Merge ranked result lists using Reciprocal Rank Fusion. */
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

/** Run multiple queries in parallel and merge results. */
export async function searchSearXNGMulti(
  queries: readonly string[],
  opts?: { perQuery?: number; maxTotal?: number },
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