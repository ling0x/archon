import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';

import type { SearchResult } from './searxng';

import 'highlight.js/styles/github-dark.css';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      let highlighted: string;
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
      const langClass = lang ? `language-${lang}` : '';
      return `<pre><code class="hljs ${langClass}">${highlighted}</code></pre>\n`;
    },
  },
});

function externalizeLinks(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return tpl.innerHTML;
}

/** [[7]] first, then [7] not already part of [7](url), then 【7】 / ［7］ */
const RAW_CITATION_RE =
  /\[\[(\d+)\]\](?!\()|\[(\d+)\](?!\()|\u3010(\d+)\u3011|\uff3b(\d+)\uff3d/g;

function citationIndexFromReplaceCallback(
  _full: string,
  d1: string | undefined,
  d2: string | undefined,
  d3: string | undefined,
  d4: string | undefined,
): number {
  const g = d1 ?? d2 ?? d3 ?? d4;
  return Number.parseInt(g ?? '0', 10);
}

function buildUrlIndex(sources: readonly SearchResult[]): Map<number, string> {
  const urlByIndex = new Map<number, string>();
  sources.forEach((r, i) => {
    const u = r.url.trim();
    if (/^https?:\/\//i.test(u)) {
      urlByIndex.set(i + 1, u);
    }
  });
  return urlByIndex;
}

/**
 * Turn visible citation markers into Markdown links before parse, so marked emits
 * `<a href="…">[n]</a>` (visible text uses escaped brackets: [\[n\]](url)).
 */
function injectCitationMarkdownLinks(
  raw: string,
  urlByIndex: Map<number, string>,
): string {
  if (urlByIndex.size === 0) return raw;

  const replaceChunk = (chunk: string): string =>
    chunk.replace(
      RAW_CITATION_RE,
      (full, d1, d2, d3, d4) => {
        const n = citationIndexFromReplaceCallback(full, d1, d2, d3, d4);
        const url = urlByIndex.get(n);
        if (!url) return full;
        return `[\\[${n}\\]](${url})`;
      },
    );

  let out = '';
  let last = 0;
  const fence = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) {
    out += replaceChunk(raw.slice(last, m.index));
    out += m[0];
    last = fence.lastIndex;
  }
  out += replaceChunk(raw.slice(last));
  return out;
}

const CITATION_LABEL_RE = /^\[\d+\]$/;

function addCitationLinkClass(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    const t = a.textContent?.trim() ?? '';
    if (CITATION_LABEL_RE.test(t)) {
      a.classList.add('citation-link');
    }
  });
  return tpl.innerHTML;
}

export function renderAnswerMarkdown(
  raw: string,
  sources: readonly SearchResult[],
): string {
  try {
    let md = raw;
    if (sources.length > 0) {
      md = injectCitationMarkdownLinks(raw, buildUrlIndex(sources));
    }
    const html = marked.parse(md) as string;
    const clean = DOMPurify.sanitize(html);
    let out = externalizeLinks(clean);
    out = addCitationLinkClass(out);
    return out;
  } catch {
    return `<p>${escapeHtml(raw)}</p>`;
  }
}
