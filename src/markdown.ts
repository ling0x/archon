import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';

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

export function renderAnswerMarkdown(raw: string): string {
  try {
    const html = marked.parse(raw) as string;
    const clean = DOMPurify.sanitize(html);
    return externalizeLinks(clean);
  } catch {
    return `<p>${escapeHtml(raw)}</p>`;
  }
}
