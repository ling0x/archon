// =============================================================================
// Page Text Extraction
// =============================================================================

export interface ExtractPagesResponse {
  pages: Record<string, { text?: string; error?: string }>;
}

/**
 * Fetch full-page text via Vite dev/preview middleware.
 */
export async function fetchExtractedTexts(urls: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (urls.length === 0) return out;

  let res: Response;
  try {
    res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [...urls] }),
    });
  } catch {
    return out;
  }

  if (!res.ok) return out;

  let data: ExtractPagesResponse;
  try {
    data = (await res.json()) as ExtractPagesResponse;
  } catch {
    return out;
  }

  const pages = data.pages ?? {};
  for (const url of urls) {
    const row = pages[url];
    const t = row?.text?.trim();
    if (t) out.set(url, t);
  }

  return out;
}