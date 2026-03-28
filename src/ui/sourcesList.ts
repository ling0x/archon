import type { SearchResult } from '../searxng';
import { escapeHtml } from '../utils/html';

export type SourcesList = {
  render: (results: SearchResult[]) => void;
  clear: () => void;
};

export function createSourcesList(
  sourcesEl: HTMLUListElement,
  sourcesSec: HTMLElement,
): SourcesList {
  return {
    render(results: SearchResult[]) {
      sourcesEl.innerHTML = '';
      if (results.length === 0) {
        sourcesSec.classList.add('hidden');
        return;
      }
      results.forEach((r) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = r.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.innerHTML = `
      <span class="source-title">${escapeHtml(r.title || r.url)}</span>
      <span class="source-url">${escapeHtml(r.url)}</span>
    `;
        li.appendChild(a);
        sourcesEl.appendChild(li);
      });
      sourcesSec.classList.remove('hidden');
    },
    clear() {
      sourcesEl.innerHTML = '';
      sourcesSec.classList.add('hidden');
    },
  };
}
