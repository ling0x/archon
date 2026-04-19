// =============================================================================
// Conversation UI - Turn Components
// =============================================================================

import type { SearchResult } from '../../searxng';
import { escapeHtml } from '../../utils/html';
import { renderAnswerMarkdown, formatAnswerForMarkdownExport } from '../../markdown';
import type { ChatTurn } from '../../chatStorage';

// =============================================================================
// Copy Button
// =============================================================================

const COPY_SVG = {
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  ok: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  err: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function setupCodeCopyHandler(container: HTMLElement): void {
  const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();

  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.code-copy-button');
    if (!btn) return;

    const pre = btn.closest('pre');
    const code = pre?.querySelector('code');
    const text = code?.textContent ?? '';
    if (!text) return;

    const copied = await copyTextToClipboard(text);
    btn.classList.toggle('is-copied', copied);
    btn.classList.toggle('is-error', !copied);
    btn.title = copied ? 'Copied to clipboard' : 'Copy failed';
    btn.setAttribute('aria-label', btn.title);

    const prev = timers.get(btn);
    if (prev !== undefined) clearTimeout(prev);
    const next = setTimeout(() => {
      btn.classList.remove('is-copied', 'is-error');
      btn.title = 'Copy code';
      btn.setAttribute('aria-label', 'Copy code');
    }, copied ? 1400 : 1800);
    timers.set(btn, next);
  });
}

// =============================================================================
// Generation Time Formatting
// =============================================================================

function formatGenerationLabel(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

// =============================================================================
// Turn Query Row
// =============================================================================

interface QueryShellResult {
  container: HTMLElement;
  trailing: HTMLElement;
}

function createQueryShell(query: string, model: string, showReasoning: boolean): QueryShellResult {
  const container = document.createElement('div');
  container.className = 'turn-query';

  const qSpan = document.createElement('span');
  qSpan.className = 'turn-query-text';
  qSpan.textContent = query;

  const trailing = document.createElement('div');
  trailing.className = 'turn-query-trailing';

  const modelTag = document.createElement('span');
  modelTag.className = 'turn-model-tag';
  modelTag.textContent = model;
  modelTag.title = `Model: ${model}`;
  trailing.appendChild(modelTag);

  if (showReasoning) {
    const r = document.createElement('span');
    r.className = 'turn-model-tag';
    r.textContent = 'Reasoning';
    r.title = 'This answer includes a model reasoning trace';
    trailing.appendChild(r);
  }

  container.append(qSpan, trailing);
  return { container, trailing };
}

export function createFinalTurnQueryRow(query: string, model: string, ms: number, showReasoning: boolean): HTMLElement {
  const { container, trailing } = createQueryShell(query, model, showReasoning);
  const timeTag = document.createElement('span');
  timeTag.className = 'turn-generation-tag';
  timeTag.textContent = formatGenerationLabel(ms);
  timeTag.title = `Answer generated in ${formatGenerationLabel(ms)}`;
  trailing.appendChild(timeTag);
  return container;
}

export function createLiveTurnQueryRow(query: string, model: string, showReasoning: boolean): { row: HTMLElement; timeTag: HTMLElement } {
  const { container, trailing } = createQueryShell(query, model, showReasoning);
  const timeTag = document.createElement('span');
  timeTag.className = 'turn-generation-tag';
  timeTag.textContent = '0 s';
  timeTag.title = 'Generating answer…';
  trailing.appendChild(timeTag);
  return { row: container, timeTag };
}

// =============================================================================
// Thinking Details
// =============================================================================

export function createPersistedThinkingDetails(text: string): HTMLElement {
  const details = document.createElement('details');
  details.className = 'turn-thinking-details turn-thinking-done';
  const summary = document.createElement('summary');
  summary.className = 'turn-thinking-summary';
  summary.textContent = 'Reasoning';
  const body = document.createElement('div');
  body.className = 'turn-thinking-body';
  body.textContent = text;
  details.append(summary, body);
  return details;
}

export function createLiveThinkingShell(): { details: HTMLDetailsElement; body: HTMLElement } {
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

// =============================================================================
// Formulation Details
// =============================================================================

export function createFormulationDetails(snapshot: {
  model?: string;
  thinkingCapable?: boolean;
  thinkingRaw?: string;
  queries?: readonly string[];
}): HTMLElement {
  const details = document.createElement('details');
  details.className = 'turn-formulation-details';
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'turn-formulation-summary';

  const label = document.createElement('span');
  label.className = 'turn-formulation-summary-label';
  label.textContent = 'Search Formulation';
  summary.appendChild(label);

  if (snapshot.model?.trim()) {
    const modelTag = document.createElement('span');
    modelTag.className = 'turn-model-tag';
    modelTag.textContent = snapshot.model.trim();
    modelTag.title = `Formulation model: ${snapshot.model.trim()}`;
    summary.appendChild(modelTag);
  }

  const reasonTag = document.createElement('span');
  reasonTag.className = 'turn-model-tag';
  reasonTag.textContent = snapshot.thinkingCapable ? 'Reasoning' : 'No reasoning';
  reasonTag.title = snapshot.thinkingCapable ? 'Formulation model reported thinking capability' : 'Formulation model did not report thinking capability';
  summary.appendChild(reasonTag);

  const body = document.createElement('div');
  body.className = 'turn-formulation-body';

  const hasQueries = Boolean(snapshot.queries?.length);
  const hasThinking = Boolean(snapshot.thinkingRaw?.trim());

  if (!hasQueries && !hasThinking) {
    const empty = document.createElement('p');
    empty.className = 'turn-formulation-empty';
    empty.textContent = 'No formulation details captured.';
    body.appendChild(empty);
  } else {
    if (hasQueries) {
      const h = document.createElement('h4');
      h.className = 'turn-formulation-heading';
      h.textContent = 'Queries';
      body.appendChild(h);

      const ol = document.createElement('ol');
      ol.className = 'turn-formulation-query-list';
      for (const q of snapshot.queries ?? []) {
        const li = document.createElement('li');
        li.textContent = q;
        ol.appendChild(li);
      }
      body.appendChild(ol);
    }

    if (hasThinking) {
      const h = document.createElement('h4');
      h.className = 'turn-formulation-heading';
      h.textContent = 'Reasoning Stream';
      body.appendChild(h);

      const pre = document.createElement('pre');
      pre.className = 'turn-formulation-thinking';
      pre.textContent = snapshot.thinkingRaw?.trim() ?? '';
      body.appendChild(pre);
    }
  }

  details.append(summary, body);
  return details;
}

// =============================================================================
// Research Plan Details
// =============================================================================

export function createResearchPlanDetails(steps: readonly string[]): HTMLElement {
  const details = document.createElement('details');
  details.className = 'turn-research-plan-details';
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'turn-research-plan-summary';
  const label = document.createElement('span');
  label.className = 'turn-research-plan-summary-label';
  label.textContent = 'Research plan';
  summary.appendChild(label);

  const body = document.createElement('div');
  body.className = 'turn-research-plan-body';
  const ol = document.createElement('ol');
  ol.className = 'turn-research-plan-list';
  for (const s of steps) {
    const li = document.createElement('li');
    li.textContent = s;
    ol.appendChild(li);
  }
  body.appendChild(ol);
  details.append(summary, body);
  return details;
}

// =============================================================================
// Research Notes Details
// =============================================================================

export function createResearchNotesDetails(text: string): HTMLElement {
  const details = document.createElement('details');
  details.className = 'turn-research-notes-details';
  details.open = false;
  const summary = document.createElement('summary');
  summary.className = 'turn-research-notes-summary';
  summary.textContent = 'Draft research notes (pass 1)';
  const pre = document.createElement('pre');
  pre.className = 'turn-research-notes-body';
  pre.textContent = text.trim();
  details.append(summary, pre);
  return details;
}

// =============================================================================
// References Section
// =============================================================================

export function createReferencesSection(results: SearchResult[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'turn-references';

  if (results.length === 0) {
    wrap.classList.add('hidden');
    return wrap;
  }

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

  results.forEach((r: SearchResult, i: number) => {
    const n = i + 1;
    const li = document.createElement('li');
    li.className = 'turn-ref-item';

    const a = document.createElement('a');
    a.className = 'turn-ref-link';
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const eng = r.engine?.trim();
    const a11yLabel = eng ? `Reference ${n}: ${r.title || r.url}. Search engine: ${eng}.` : `Reference ${n}: ${r.title || r.url}`;
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
  wrap.appendChild(details);
  return wrap;
}

// =============================================================================
// Answer Footer
// =============================================================================

export function createAnswerFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'turn-answer-footer';
  return footer;
}

// =============================================================================
// Export Button
// =============================================================================

type TurnExportPayload = Pick<ChatTurn, 'query' | 'model' | 'answerRaw' | 'sources'> & {
  thinkingRaw?: string;
  error?: string;
  generationMs?: number;
  researchPlan?: string[];
  researchNotesRaw?: string;
};

function slugForFilename(text: string, maxLen = 40): string {
  return text.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '') || 'answer';
}

function escapeMdLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function buildTurnMarkdownForExport(t: TurnExportPayload): string {
  const parts: string[] = [];

  parts.push('## Question\n', `${t.query.trim()}\n\n`, `**Model:** \`${t.model.trim()}\`\n\n`);
  if (t.generationMs != null) parts.push(`**Answer time:** ${formatGenerationLabel(t.generationMs)}\n\n`);
  parts.push('---\n\n');

  if (t.error?.trim()) parts.push(`> **Error:** ${t.error.trim()}\n\n`);
  if (t.thinkingRaw?.trim()) parts.push('## Reasoning trace\n\n```\n' + t.thinkingRaw.trim() + '\n```\n\n');

  if (t.researchPlan?.length) {
    parts.push('## Research plan\n\n');
    t.researchPlan.forEach((s, i) => parts.push(`${i + 1}. ${s}\n`));
    parts.push('\n');
  }

  if (t.researchNotesRaw?.trim()) parts.push('## Draft research notes (pass 1)\n\n```\n' + t.researchNotesRaw.trim() + '\n```\n\n');

  if (t.answerRaw.trim()) parts.push(formatAnswerForMarkdownExport(t.answerRaw.trim(), t.sources) + '\n\n');

  if (t.sources.length > 0) {
    parts.push('## References\n\n');
    t.sources.forEach((r: SearchResult, i: number) => {
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

function downloadMarkdown(filename: string, text: string): void {
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

export function createExportButton(getTurn: () => TurnExportPayload): { refresh: () => void; button: HTMLButtonElement } {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'turn-export-md';
  btn.textContent = 'Export MD';
  btn.title = 'Download this turn as a Markdown file';

  function refresh(): void {
    const t = getTurn();
    const hasContent = Boolean(t.answerRaw.trim() || t.error?.trim() || t.thinkingRaw?.trim());
    btn.disabled = !hasContent;
  }

  btn.addEventListener('click', () => {
    const t = getTurn();
    const md = buildTurnMarkdownForExport(t);
    downloadMarkdown(`archon-${slugForFilename(t.query)}.md`, md);
  });

  return { refresh, button: btn };
}