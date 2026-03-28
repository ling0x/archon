import { prependChat } from '../chatStorage';
import { setCurrentChatId } from '../session';
import { buildSearchContext } from '../context/buildSearchContext';
import { streamOllamaAnswer } from '../ollama';
import { searchSearXNG, type SearchResult } from '../searxng';
import type { AnswerPanel } from '../ui/answerPanel';
import type { ChatHistoryView } from '../ui/chatHistory';
import type { SourcesList } from '../ui/sourcesList';
import type { StatusBar } from '../ui/statusBar';

export type SearchFlowDeps = {
  status: StatusBar;
  answer: AnswerPanel;
  sources: SourcesList;
  submitBtn: HTMLButtonElement;
  btnLabel: HTMLSpanElement;
  history: ChatHistoryView;
};

export async function runSearch(query: string, deps: SearchFlowDeps): Promise<void> {
  const { status, answer, sources, submitBtn, btnLabel, history } = deps;

  answer.clear();
  sources.clear();
  answer.hideSection();
  submitBtn.disabled = true;
  btnLabel.textContent = 'Searching…';

  let results: SearchResult[] = [];

  try {
    status.set('Searching the web via SearXNG…');
    results = await searchSearXNG(query);

    if (results.length === 0) {
      status.set('No search results found. Asking Ollama anyway…');
    } else {
      status.set(`Found ${results.length} results. Generating answer…`);
      sources.render(results);
    }
  } catch (err) {
    status.set(
      `Search failed: ${(err as Error).message}. Attempting to answer without search results…`,
      true,
    );
  }

  answer.showSection();
  answer.clear();
  let answerRaw = '';
  btnLabel.textContent = 'Thinking…';

  try {
    const context = buildSearchContext(results);
    for await (const token of streamOllamaAnswer(query, context)) {
      answerRaw += token;
      answer.setFromMarkdown(answerRaw);
    }
    status.clear();

    const saved = prependChat({
      query,
      answerRaw,
      sources: results,
    });
    setCurrentChatId(saved.id);
    history.render();
    history.syncActive();
  } catch (err) {
    const msg = (err as Error).message;
    status.set(`Ollama error: ${msg}`, true);

    const saved = prependChat({
      query,
      answerRaw,
      sources: results,
      error: msg,
    });
    setCurrentChatId(saved.id);
    history.render();
    history.syncActive();
  } finally {
    submitBtn.disabled = false;
    btnLabel.textContent = 'Search';
  }
}
