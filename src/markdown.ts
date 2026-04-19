// =============================================================================
// Markdown Rendering
// =============================================================================

import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import type { SearchResult } from './searxng';
import { escapeHtml } from './utils/html';

// =============================================================================
// Language Labels
// =============================================================================

const LANGUAGE_LABELS: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', jsx: 'JSX',
  py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby',
  rs: 'Rust', rust: 'Rust', go: 'Go', golang: 'Go',
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', shell: 'Shell',
  ps1: 'PowerShell', pwsh: 'PowerShell',
  yml: 'YAML', yaml: 'YAML', md: 'Markdown', markdown: 'Markdown',
  json: 'JSON', jsonc: 'JSON', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  html: 'HTML', xml: 'XML', svg: 'SVG', sql: 'SQL',
  cpp: 'C++', cxx: 'C++', cc: 'C++', hpp: 'C++',
  csharp: 'C#', cs: 'C#', fs: 'F#', fsharp: 'F#',
  kt: 'Kotlin', kotlin: 'Kotlin', swift: 'Swift', java: 'Java', php: 'PHP',
  r: 'R', lua: 'Lua', perl: 'Perl',
  dockerfile: 'Dockerfile', docker: 'Dockerfile',
  toml: 'TOML', ini: 'INI', env: 'Env',
  plaintext: 'Plain text', text: 'Plain text', txt: 'Plain text',
};

function titleCaseLanguageToken(token: string): string {
  const t = token.toLowerCase();
  if (t === 'c++' || t === 'cpp') return 'C++';
  if (t === 'c#' || t === 'csharp') return 'C#';
  if (t === 'f#') return 'F#';
  if (t === 'r') return 'R';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatLanguageLabel(id: string): string {
  const key = id.trim().toLowerCase();
  if (!key) return '';
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key];
  return key.split(/[-_+/]/).filter(Boolean).map(titleCaseLanguageToken).join(' ');
}

// =============================================================================
// Code Highlighting
// =============================================================================

const COPY_SVG = {
  copy: '<svg class="code-copy-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  ok: '<svg class="code-copy-svg code-copy-svg-success" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  err: '<svg class="code-copy-svg code-copy-svg-error" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

function codeCopyButtonHtml(): string {
  return `<button type="button" class="code-copy-button" title="Copy code" aria-label="Copy code">${COPY_SVG.copy}${COPY_SVG.ok}${COPY_SVG.err}</button>`;
}

function highlightCodeBlock(text: string, fenceLang: string | undefined): { highlighted: string; displayLabel: string | null; langClass: string } {
  const fence = fenceLang?.trim();

  if (fence) {
    if (hljs.getLanguage(fence)) {
      const highlighted = hljs.highlight(text, { language: fence, ignoreIllegals: true }).value;
      return { highlighted, displayLabel: formatLanguageLabel(fence), langClass: `language-${fence}` };
    }
    const auto = hljs.highlightAuto(text);
    return { highlighted: auto.value, displayLabel: formatLanguageLabel(fence), langClass: `language-${auto.language ?? ''}` };
  }

  const auto = hljs.highlightAuto(text);
  const detected = auto.language;
  if (detected && detected !== 'plaintext') {
    return { highlighted: auto.value, displayLabel: formatLanguageLabel(detected), langClass: `language-${detected}` };
  }
  return { highlighted: auto.value, displayLabel: null, langClass: '' };
}

// =============================================================================
// Citation Processing
// =============================================================================

/**
 * Citation markers to turn into links.
 * - [[n]] — style from system prompt
 * - [n] — when model omits second bracket
 */
const CITATION_RE = /\[\[(\d+)\]\](?!\()|\[(\d+)\](?!\()/g;

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

/** Apply transform to segments outside ``` fenced code blocks. */
function transformOutsideCodeFences(raw: string, transform: (chunk: string) => string): string {
  let out = '';
  let last = 0;
  const fence = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;

  while ((m = fence.exec(raw)) !== null) {
    out += transform(raw.slice(last, m.index));
    out += m[0];
    last = fence.lastIndex;
  }
  out += transform(raw.slice(last));
  return out;
}

function markdownLinkDestination(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/[\s()]/.test(u)) {
    return `<${u.replace(/\\/g, '\\\\').replace(/>/g, '\\>')}>`;
  }
  return u;
}

function injectCitationMarkdownLinks(raw: string, urlByIndex: Map<number, string>): string {
  if (urlByIndex.size === 0) return raw;

  return transformOutsideCodeFences(raw, (chunk) =>
    chunk.replace(CITATION_RE, (full, g1, g2) => {
      const nStr = g1 ?? g2;
      if (!nStr) return full;
      const n = Number.parseInt(nStr, 10);
      const url = urlByIndex.get(n);
      if (!url) return full;
      return `[\\[${n}\\]](${markdownLinkDestination(url)})`;
    }),
  );
}

// =============================================================================
// External Links
// =============================================================================

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

// =============================================================================
// Setup Marked Renderer
// =============================================================================

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const fence = typeof lang === 'string' && lang.trim() ? lang.trim() : undefined;
      const { highlighted, displayLabel, langClass } = highlightCodeBlock(text, fence);
      const labelHtml = displayLabel != null ? `<span class="code-lang-label">${escapeHtml(displayLabel)}</span>` : '';
      const codeClass = ['hljs', langClass].filter(Boolean).join(' ');

      return `<pre class="code-block"><div class="code-block-head">${labelHtml}${codeCopyButtonHtml()}</div><code class="${codeClass}">${highlighted}</code></pre>\n`;
    },
  },
});

// =============================================================================
// Public API
// =============================================================================

export function renderAnswerMarkdown(raw: string, sources: readonly SearchResult[]): string {
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

export function formatAnswerForMarkdownExport(raw: string, sources: readonly SearchResult[]): string {
  if (sources.length === 0) return raw;
  const urlByIndex = buildUrlIndex(sources);
  if (urlByIndex.size === 0) return raw;

  return transformOutsideCodeFences(raw, (chunk) =>
    chunk.replace(CITATION_RE, (full, g1, g2) => {
      const nStr = g1 ?? g2;
      if (!nStr) return full;
      const n = Number.parseInt(nStr, 10);
      const url = urlByIndex.get(n);
      if (!url) return full;
      return `[${n}](${markdownLinkDestination(url)})`;
    }),
  );
}