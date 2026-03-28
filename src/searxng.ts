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
