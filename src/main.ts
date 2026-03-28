import { searchSearXNG, type SearchResult } from './searxng';
import { streamOllamaAnswer } from './ollama';
import { renderAnswerMarkdown } from './markdown';

const form        = document.getElementById('search-form')    as HTMLFormElement;
const input       = document.getElementById('query-input')    as HTMLInputElement;
const submitBtn   = document.getElementById('submit-btn')     as HTMLButtonElement;
const btnLabel    = document.getElementById('btn-label')      as HTMLSpanElement;
const statusEl    = document.getElementById('status')         as HTMLElement;
const answerSec   = document.getElementById('answer-section') as HTMLElement;
const answerEl    = document.getElementById('answer')         as HTMLElement;
const sourcesSec  = document.getElementById('sources-section')as HTMLElement;
const sourcesEl   = document.getElementById('sources')        as HTMLUListElement;

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden', 'error');
  if (isError) statusEl.classList.add('error');
}

function clearStatus() {
  statusEl.classList.add('hidden');
  statusEl.textContent = '';
}

function renderSources(results: SearchResult[]) {
  sourcesEl.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    const a  = document.createElement('a');
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
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildContext(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  // reset UI
  answerEl.innerHTML = '';
  sourcesEl.innerHTML   = '';
  answerSec.classList.add('hidden');
  sourcesSec.classList.add('hidden');
  submitBtn.disabled  = true;
  btnLabel.textContent = 'Searching…';

  let results: SearchResult[] = [];

  try {
    setStatus('Searching the web via SearXNG…');
    results = await searchSearXNG(query);

    if (results.length === 0) {
      setStatus('No search results found. Asking Ollama anyway…');
    } else {
      setStatus(`Found ${results.length} results. Generating answer…`);
      renderSources(results);
    }
  } catch (err) {
    setStatus(`Search failed: ${(err as Error).message}. Attempting to answer without search results…`, true);
  }

  answerSec.classList.remove('hidden');
  answerEl.innerHTML = '';
  let answerRaw = '';
  btnLabel.textContent = 'Thinking…';

  try {
    const context = buildContext(results);
    for await (const token of streamOllamaAnswer(query, context)) {
      answerRaw += token;
      answerEl.innerHTML = renderAnswerMarkdown(answerRaw);
    }
    clearStatus();
  } catch (err) {
    setStatus(`Ollama error: ${(err as Error).message}`, true);
  } finally {
    submitBtn.disabled   = false;
    btnLabel.textContent = 'Search';
  }
});
