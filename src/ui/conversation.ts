import type { ChatRecord, ChatTurn } from '../chatStorage';
import { renderAnswerMarkdown } from '../markdown';
import type { SearchResult } from '../searxng';
import { escapeHtml } from '../utils/html';
import { getSelectedModel, refreshReasoningTagForModel } from '../modelPicker';
import { startGenerationTicker } from './generationTimer';

/** Subset of turn fields for markdown export; `generationMs` exists only after the run completes. */
type TurnExportPayload = Pick<ChatTurn, 'query' | 'model' | 'answerRaw' | 'sources'> & {
  thinkingRaw?: string;
  error?: string;
  generationMs?: number;
};

function slugForFilename(text: string, maxLen = 40): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return s || 'answer';
}

function escapeMdLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function buildTurnMarkdownForExport(t: TurnExportPayload): string {
  const parts: string[] = [];

  parts.push('## Question\n');
  parts.push(`${t.query.trim()}\n\n`);
  parts.push(`**Model:** \`${t.model.trim()}\`\n\n`);
  if (t.generationMs != null) {
    parts.push(`**Answer time:** ${formatGenerationLabel(t.generationMs)}\n\n`);
  }
  parts.push('---\n\n');

  if (t.error?.trim()) {
    parts.push(`> **Error:** ${t.error.trim()}\n\n`);
  }

  if (t.thinkingRaw?.trim()) {
    parts.push('## Reasoning trace\n\n');
    parts.push('```\n');
    parts.push(`${t.thinkingRaw.trim()}\n`);
    parts.push('```\n\n');
  }

  if (t.answerRaw.trim()) {
    parts.push(`${t.answerRaw.trim()}\n\n`);
  }

  if (t.sources.length > 0) {
    parts.push('## References\n\n');
    t.sources.forEach((r, i) => {
      const title = (r.title || r.url).trim();
      const url = r.url.trim();
      const eng = r.engine?.trim();
      const engSuffix = eng ? ` _(${escapeMdLinkText(eng)})_` : '';
      if (/^https?:\/\//i.test(url)) {
        parts.push(`${i + 1}. [${escapeMdLinkText(title)}](${url})${engSuffix}\n`);
      } else {
        parts.push(`${i + 1}. ${title}${engSuffix}\n`);
      }
    });
    parts.push('\n');
  }

  return parts.join('').replace(/\n+$/, '') + '\n';
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function attachExportMarkdownButton(
  mountEl: HTMLElement,
  getTurn: () => TurnExportPayload,
): { refresh: () => void } {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'turn-export-md';
  btn.textContent = 'Export MD';
  btn.title = 'Download this turn as a Markdown file';
  mountEl.appendChild(btn);

  function refresh(): void {
    const t = getTurn();
    const hasContent =
      Boolean(t.answerRaw.trim()) ||
      Boolean(t.error?.trim()) ||
      Boolean(t.thinkingRaw?.trim());
    btn.disabled = !hasContent;
  }

  btn.addEventListener('click', () => {
    const t = getTurn();
    const md = buildTurnMarkdownForExport(t);
    const name = `archon-${slugForFilename(t.query)}.md`;
    downloadTextFile(name, md);
  });

  refresh();
  return { refresh };
}

function formatGenerationLabel(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

function mountTurnQueryShell(
  row: HTMLElement,
  query: string,
  model: string,
  showReasoningTag: boolean,
): HTMLElement {
  row.textContent = '';
  const qSpan = document.createElement('span');
  qSpan.className = 'turn-query-text';
  qSpan.textContent = query;
  const trailing = document.createElement('div');
  trailing.className = 'turn-query-trailing';
  const tag = document.createElement('span');
  tag.className = 'turn-model-tag';
  const label = model.trim();
  tag.textContent = label;
  tag.title = `Model: ${label}`;
  trailing.appendChild(tag);
  if (showReasoningTag) {
    const r = document.createElement('span');
    r.className = 'composer-reasoning-tag';
    r.textContent = 'Reasoning';
    r.title = 'This model can stream a separate reasoning trace from Ollama';
    trailing.appendChild(r);
  }
  row.append(qSpan, trailing);
  return trailing;
}

function fillTurnQueryRowWithFinalTime(
  row: HTMLElement,
  query: string,
  model: string,
  finalMs: number,
  showReasoningTag: boolean,
): void {
  const trailing = mountTurnQueryShell(row, query, model, showReasoningTag);
  const timeTag = document.createElement('span');
  timeTag.className = 'turn-generation-tag';
  const formatted = formatGenerationLabel(finalMs);
  timeTag.textContent = formatted;
  timeTag.title = `Answer generated in ${formatted}`;
  trailing.appendChild(timeTag);
}

/** @returns Stop function for the live ticker. */
function fillTurnQueryRowWithLiveTimer(
  row: HTMLElement,
  query: string,
  model: string,
  showReasoningTag: boolean,
): () => void {
  const trailing = mountTurnQueryShell(row, query, model, showReasoningTag);
  const timeTag = document.createElement('span');
  timeTag.className = 'turn-generation-tag';
  timeTag.textContent = '0 s';
  timeTag.title = 'Generating answer…';
  trailing.appendChild(timeTag);
  return startGenerationTicker((secLabel, wholeSeconds) => {
    timeTag.textContent = secLabel;
    timeTag.title =
      wholeSeconds === 0
        ? 'Generating answer…'
        : `Generating answer… ${secLabel} elapsed`;
  }).stop;
}

function createTurnAnswerFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'turn-answer-footer';
  return footer;
}

function fallbackCopyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyText(text);
    }
  }
  return fallbackCopyText(text);
}

const COPY_BTN_TITLE_DEFAULT = 'Copy code';
const COPY_BTN_TITLE_OK = 'Copied to clipboard';
const COPY_BTN_TITLE_ERR = 'Copy failed';

function createPersistedThinkingDetails(text: string): HTMLElement {
  const details = document.createElement('details');
  details.className = 'turn-thinking-details turn-thinking-done';
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'turn-thinking-summary';
  summary.textContent = 'Reasoning';

  const body = document.createElement('div');
  body.className = 'turn-thinking-body';
  body.textContent = text;

  details.append(summary, body);
  return details;
}

function createLiveThinkingShell(): {
  details: HTMLDetailsElement;
  body: HTMLElement;
} {
  const details = document.createElement('details');
  details.className = 'turn-thinking-details';
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'turn-thinking-summary';
  summary.textContent = 'Reasoning';

  const body = document.createElement('div');
  body.className = 'turn-thinking-body';

  details.append(summary, body);
  return { details, body };
}

function renderReferencesSection(parent: HTMLElement, results: SearchResult[]): void {
  parent.innerHTML = '';
  if (results.length === 0) {
    parent.classList.add('hidden');
    return;
  }
  parent.classList.remove('hidden');

  const details = document.createElement('details');
  details.className = 'turn-references-details';

  const summary = document.createElement('summary');
  summary.className = 'turn-references-summary';

  const summaryLabel = document.createElement('span');
  summaryLabel.className = 'turn-references-summary-label';
  summaryLabel.textContent = 'References';

  const summaryCount = document.createElement('span');
  summaryCount.className = 'turn-references-count';
  summaryCount.textContent = `(${results.length})`;

  summary.append(summaryLabel, summaryCount);
  details.appendChild(summary);

  const ul = document.createElement('ul');
  ul.className = 'turn-references-list';

  results.forEach((r, i) => {
    const n = i + 1;
    const li = document.createElement('li');
    li.className = 'turn-ref-item';
    const a = document.createElement('a');
    a.className = 'turn-ref-link';
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const eng = r.engine?.trim();
    const a11yLabel = eng
      ? `Reference ${n}: ${r.title || r.url}. Search engine: ${eng}.`
      : `Reference ${n}: ${r.title || r.url}`;
    a.setAttribute('aria-label', a11yLabel);
    const title = escapeHtml(r.title || r.url);
    const urlText = escapeHtml(r.url);
    const engineHtml = eng ? `<span class="turn-ref-engine">${escapeHtml(eng)}</span>` : '';
    a.innerHTML = `
      <span class="turn-ref-index" aria-hidden="true">${n}</span>
      <span class="turn-ref-body">
        <span class="turn-ref-title">${title}</span>
        <span class="turn-ref-meta">
          <span class="turn-ref-url">${urlText}</span>
          ${engineHtml}
        </span>
      </span>
    `;
    li.appendChild(a);
    ul.appendChild(li);
  });

  details.appendChild(ul);
  parent.appendChild(details);
}

function renderTurnContent(aEl: HTMLElement, turn: ChatTurn): void {
  let html = '';
  if (turn.error) {
    html += `<p class="turn-error-note">${escapeHtml(turn.error)}</p>`;
  }
  if (turn.answerRaw) {
    html += renderAnswerMarkdown(turn.answerRaw, turn.sources);
  }
  aEl.innerHTML = html;
}

function cloneModelSelectOptions(from: HTMLSelectElement, to: HTMLSelectElement): void {
  to.innerHTML = from.innerHTML;
  to.value = from.value;
}

function createFollowupSlot(isLast: boolean): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'composer-strip turn-followup-strip';

  const form = document.createElement('form');
  form.className = 'composer-strip-form turn-followup';
  form.setAttribute('aria-label', 'Follow-up question');

  const row = document.createElement('div');
  row.className = 'input-row turn-followup-row';

  const ta = document.createElement('textarea');
  ta.className = 'composer-input turn-followup-input';
  ta.autocomplete = 'off';
  if (isLast) {
    ta.placeholder = 'Ask a follow-up…';
  } else {
    ta.placeholder = 'Continue with the composer below';
    ta.classList.add('is-followup-inactive');
  }

  const submitRow = document.createElement('div');
  submitRow.className = 'composer-submit-row';

  const modelCluster = document.createElement('div');
  modelCluster.className = 'composer-model-cluster';

  const modelWrap = document.createElement('div');
  modelWrap.className = 'composer-model-inline';

  const label = document.createElement('label');
  label.className = 'composer-model-label';
  label.textContent = 'Model';

  const modelSel = document.createElement('select');
  modelSel.className = 'composer-model-select';
  modelSel.setAttribute('aria-label', 'Ollama model');
  const sid = `followup-model-${crypto.randomUUID()}`;
  label.htmlFor = sid;
  modelSel.id = sid;

  const template = document.querySelector<HTMLSelectElement>('#model-select');
  if (template) {
    cloneModelSelectOptions(template, modelSel);
  }

  if (!isLast) {
    modelSel.classList.add('is-followup-inactive');
  }

  modelWrap.append(label, modelSel);

  const tplReason = document.querySelector<HTMLElement>('#search-form .composer-reasoning-tag');
  if (tplReason) {
    const reasonEl = tplReason.cloneNode(true) as HTMLElement;
    if (!isLast) reasonEl.classList.add('is-followup-inactive');
    modelCluster.append(modelWrap, reasonEl);
  } else {
    modelCluster.appendChild(modelWrap);
  }

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'composer-submit-btn turn-followup-submit';
  if (!isLast) btn.classList.add('is-followup-inactive');

  const span = document.createElement('span');
  span.className = 'composer-submit-label';
  span.textContent = 'Search';
  btn.appendChild(span);

  submitRow.append(modelCluster, btn);
  row.append(ta, submitRow);
  form.appendChild(row);

  const statusLine = document.createElement('div');
  statusLine.className = 'composer-status turn-followup-composer-status hidden';
  statusLine.setAttribute('aria-live', 'polite');

  strip.append(form, statusLine);
  return strip;
}

export type TurnUi = {
  setSources: (results: SearchResult[]) => void;
  setAnswerMarkdown: (raw: string) => void;
  appendThinkingChunk: (text: string) => void;
};

export type ConversationView = {
  clear: () => void;
  show: () => void;
  hide: () => void;
  renderChat: (chat: ChatRecord) => void;
  startTurn: (query: string, model: string, opts?: { thinkingCapable?: boolean }) => TurnUi;
  scrollToBottom: () => void;
};

export function createConversationView(
  container: HTMLElement,
  section: HTMLElement,
): ConversationView {
  const copyResetTimers = new WeakMap<HTMLButtonElement, number>();
  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLButtonElement>('button.code-copy-button');
    if (!btn) return;

    const pre = btn.closest('pre');
    const code = pre?.querySelector('code');
    const text = code?.textContent ?? '';
    if (!text) return;

    void (async () => {
      const copied = await copyTextToClipboard(text);
      btn.classList.toggle('is-copied', copied);
      btn.classList.toggle('is-error', !copied);
      const title = copied ? COPY_BTN_TITLE_OK : COPY_BTN_TITLE_ERR;
      btn.title = title;
      btn.setAttribute('aria-label', title);

      const prevTimer = copyResetTimers.get(btn);
      if (prevTimer != null) window.clearTimeout(prevTimer);
      const nextTimer = window.setTimeout(() => {
        btn.classList.remove('is-copied', 'is-error');
        btn.title = COPY_BTN_TITLE_DEFAULT;
        btn.setAttribute('aria-label', COPY_BTN_TITLE_DEFAULT);
      }, copied ? 1400 : 1800);
      copyResetTimers.set(btn, nextTimer);
    })();
  });

  function scrollToBottom() {
    container.scrollTop = container.scrollHeight;
  }

  let stopGenerationTicker: (() => void) | undefined;

  function disposeGenerationTicker(): void {
    stopGenerationTicker?.();
    stopGenerationTicker = undefined;
  }

  return {
    clear() {
      disposeGenerationTicker();
      container.innerHTML = '';
    },
    show() {
      section.classList.remove('hidden');
    },
    hide() {
      section.classList.add('hidden');
    },
    renderChat(chat: ChatRecord) {
      disposeGenerationTicker();
      container.innerHTML = '';
      const n = chat.turns.length;
      chat.turns.forEach((turn, index) => {
        const article = document.createElement('article');
        article.className = 'turn';
        article.dataset.turnId = turn.id;

        const qEl = document.createElement('div');
        qEl.className = 'turn-query';
        const showReasoning =
          turn.thinkingCapable === true || Boolean(turn.thinkingRaw?.trim());
        fillTurnQueryRowWithFinalTime(
          qEl,
          turn.query,
          turn.model,
          turn.generationMs,
          showReasoning,
        );

        const thinkingEl =
          turn.thinkingRaw?.trim() ? createPersistedThinkingDetails(turn.thinkingRaw.trim()) : null;

        const aEl = document.createElement('div');
        aEl.className = 'turn-answer markdown-body';

        const refWrap = document.createElement('div');
        refWrap.className = 'turn-references';

        const answerFooter = createTurnAnswerFooter();
        attachExportMarkdownButton(answerFooter, () => turn);

        renderTurnContent(aEl, turn);
        renderReferencesSection(refWrap, turn.sources);

        article.append(qEl);
        if (thinkingEl) article.appendChild(thinkingEl);
        article.append(aEl, refWrap, answerFooter);
        container.appendChild(article);

        const isLast = index === n - 1;
        container.appendChild(createFollowupSlot(isLast));
      });

      const tplSel = document.querySelector<HTMLSelectElement>('#model-select');
      if (tplSel) void refreshReasoningTagForModel(getSelectedModel(tplSel));
      section.classList.remove('hidden');
      scrollToBottom();
      requestAnimationFrame(() => {
        container
          .querySelector<HTMLTextAreaElement>(
            '.turn-followup-input:not([disabled]):not(.is-followup-inactive)',
          )
          ?.focus();
      });
    },

    startTurn(
      query: string,
      model: string,
      opts: { thinkingCapable?: boolean } = {},
    ): TurnUi {
      disposeGenerationTicker();

      const { thinkingCapable = false } = opts;

      const article = document.createElement('article');
      article.className = 'turn turn-pending';

      const qEl = document.createElement('div');
      qEl.className = 'turn-query';
      stopGenerationTicker = fillTurnQueryRowWithLiveTimer(qEl, query, model, thinkingCapable);

      const aEl = document.createElement('div');
      aEl.className = 'turn-answer markdown-body';

      const refWrap = document.createElement('div');
      refWrap.className = 'turn-references hidden';

      const answerFooter = createTurnAnswerFooter();
      article.append(qEl, aEl, refWrap, answerFooter);
      container.appendChild(article);
      section.classList.remove('hidden');
      scrollToBottom();

      let turnSources: SearchResult[] = [];
      let answerSnapshot = '';
      let thinkingSnapshot = '';
      let liveThinking: { details: HTMLDetailsElement; body: HTMLElement } | null = null;

      const exportCtl = attachExportMarkdownButton(answerFooter, () => ({
        query,
        model,
        answerRaw: answerSnapshot,
        thinkingRaw: thinkingSnapshot.trim() || undefined,
        sources: turnSources,
      }));

      return {
        setSources(results: SearchResult[]) {
          turnSources = results;
          renderReferencesSection(refWrap, results);
        },
        setAnswerMarkdown(raw: string) {
          answerSnapshot = raw;
          aEl.innerHTML = renderAnswerMarkdown(raw, turnSources);
          exportCtl.refresh();
          scrollToBottom();
        },
        appendThinkingChunk(text: string) {
          if (!text) return;
          thinkingSnapshot += text;
          if (!liveThinking) {
            liveThinking = createLiveThinkingShell();
            liveThinking.details.classList.add('turn-thinking-done');
            article.insertBefore(liveThinking.details, aEl);
          }
          liveThinking.body.textContent += text;
          exportCtl.refresh();
          scrollToBottom();
        },
      };
    },

    scrollToBottom,
  };
}
