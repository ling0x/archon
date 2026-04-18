import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const MAX_BODY_BYTES = 2_000_000;
const DEFAULT_FETCH_MS = 18_000;
const MAX_URLS = 12;

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extractWithReadability(html: string, url: string): string | null {
  const { document } = parseHTML(html);
  try {
    const base = new URL(url);
    document.querySelectorAll('a[href]').forEach((a) => {
      const el = a as unknown as { href?: string };
      try {
        if (el.href) el.href = new URL(el.href, base).href;
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }

  const reader = new Readability(document);
  const article = reader.parse();
  if (article?.textContent?.trim()) {
    return article.textContent.replace(/\s+/g, ' ').trim();
  }
  const body = document.body;
  if (body?.textContent?.trim()) {
    return body.textContent.replace(/\s+/g, ' ').trim();
  }
  return null;
}

async function fetchAndExtractText(
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'ArchonResearchBot/1.0 (+local; https://github.com/) Mozilla/5.0 compatible',
      },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ct) && !ct.includes('text/plain')) {
      return { ok: false, error: 'Not HTML' };
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    const text = extractWithReadability(html, url);
    if (!text) return { ok: false, error: 'No extractable text' };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export type ContentExtractPluginOptions = {
  perUrlCharCap: number;
  totalCharCap: number;
  fetchTimeoutMs: number;
  maxResponseBytes: number;
};

function attachExtractMiddleware(
  server: Pick<ViteDevServer, 'middlewares'>,
  opts: ContentExtractPluginOptions,
): void {
  const { perUrlCharCap, totalCharCap, fetchTimeoutMs, maxResponseBytes } = opts;

  server.middlewares.use('/api/extract', async (req, res, next) => {
        if (req.method !== 'POST') {
          (res as ServerResponse).statusCode = 405;
          (res as ServerResponse).end();
          return;
        }
        try {
          const raw = await readRequestBody(req as IncomingMessage, 64 * 1024);
          let urls: string[] = [];
          try {
            const j = JSON.parse(raw) as { urls?: unknown };
            if (Array.isArray(j.urls)) {
              urls = j.urls
                .filter((u): u is string => typeof u === 'string')
                .filter(isAllowedUrl)
                .slice(0, MAX_URLS);
            }
          } catch {
            (res as ServerResponse).statusCode = 400;
            (res as ServerResponse).setHeader('Content-Type', 'application/json');
            (res as ServerResponse).end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          const out: Record<string, { text?: string; error?: string }> = {};
          let budget = totalCharCap;

          for (const url of urls) {
            if (budget <= 0) break;
            const cap = Math.min(perUrlCharCap, budget);
            const r = await fetchAndExtractText(url, fetchTimeoutMs, maxResponseBytes);
            if (!r.ok) {
              out[url] = { error: r.error };
              continue;
            }
            const text = r.text.length > cap ? `${r.text.slice(0, cap)}…` : r.text;
            out[url] = { text };
            budget -= text.length;
          }

          (res as ServerResponse).setHeader('Content-Type', 'application/json');
          (res as ServerResponse).end(JSON.stringify({ pages: out }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          (res as ServerResponse).statusCode = 500;
          (res as ServerResponse).setHeader('Content-Type', 'application/json');
          (res as ServerResponse).end(JSON.stringify({ error: msg }));
        }
      });
}

export function contentExtractPlugin(opts: ContentExtractPluginOptions): Plugin {
  return {
    name: 'archon-content-extract',
    configureServer(server) {
      attachExtractMiddleware(server, opts);
    },
    configurePreviewServer(server) {
      attachExtractMiddleware(server, opts);
    },
  };
}
