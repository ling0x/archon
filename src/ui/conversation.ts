// =============================================================================
// Conversation View
// =============================================================================

import type { ChatRecord, ChatTurn, ConversationView, TurnUi } from '../types';
import { renderAnswerMarkdown } from '../markdown';
import { startGenerationTicker } from './generationTimer';
import type { SearchResult } from '../searxng';
import {
  setupCodeCopyHandler,
  createFinalTurnQueryRow,
  createLiveTurnQueryRow,
  createPersistedThinkingDetails,
  createLiveThinkingShell,
  createFormulationDetails,
  createResearchPlanDetails,
  createResearchNotesDetails,
  createReferencesSection,
  createAnswerFooter,
  createExportButton,
} from './conversation/components';
import { createFollowupSlot } from './conversation/followup';
import { refreshReasoningTagForModel } from '../modelPicker';

function renderTurnContent(aEl: HTMLElement, turn: ChatTurn): void {
  let html = '';
  if (turn.error) {
    html += `<p class="turn-error-note">${turn.error}</p>`;
  }
  if (turn.answerRaw) {
    html += renderAnswerMarkdown(turn.answerRaw, turn.sources);
  }
  aEl.innerHTML = html;
}

export function createConversationView(
  container: HTMLElement,
  section: HTMLElement,
): ConversationView {
  setupCodeCopyHandler(container);

  function scrollToBottom(): void {
    container.scrollTop = container.scrollHeight;
  }

  let stopGenerationTicker: (() => void) | undefined;

  function disposeGenerationTicker(): void {
    stopGenerationTicker?.();
    stopGenerationTicker = undefined;
  }

  return {
    clear(): void {
      disposeGenerationTicker();
      container.innerHTML = '';
    },

    show(): void {
      section.classList.remove('hidden');
    },

    hide(): void {
      section.classList.add('hidden');
    },

    renderChat(chat: ChatRecord): void {
      disposeGenerationTicker();
      container.innerHTML = '';

      const n = chat.turns.length;
      chat.turns.forEach((turn, index) => {
        const article = document.createElement('article');
        article.className = 'turn';
        article.dataset.turnId = turn.id;

        const qEl = createFinalTurnQueryRow(
          turn.query,
          turn.model,
          turn.generationMs,
          turn.thinkingCapable === true,
        );
        article.appendChild(qEl);

        if (turn.formulationQueries?.length || turn.formulationThinkingRaw?.trim()) {
          article.appendChild(createFormulationDetails({
            model: turn.formulationModel,
            thinkingCapable: turn.formulationThinkingCapable === true,
            thinkingRaw: turn.formulationThinkingRaw,
            queries: turn.formulationQueries,
          }));
        }

        if (turn.researchPlan?.length) {
          article.appendChild(createResearchPlanDetails(turn.researchPlan));
        }

        if (turn.researchNotesRaw?.trim() && turn.deepResearch) {
          article.appendChild(createResearchNotesDetails(turn.researchNotesRaw));
        }

        if (turn.thinkingRaw?.trim()) {
          article.appendChild(createPersistedThinkingDetails(turn.thinkingRaw.trim()));
        }

        const aEl = document.createElement('div');
        aEl.className = 'turn-answer markdown-body';
        renderTurnContent(aEl, turn);
        article.appendChild(aEl);

        const refWrap = createReferencesSection(turn.sources);
        article.appendChild(refWrap);

        const footer = createAnswerFooter();
        footer.appendChild(createExportButton(() => turn).button);
        article.appendChild(footer);

        container.appendChild(article);

        const isLast = index === n - 1;
        container.appendChild(createFollowupSlot(isLast));
      });

      const tplSel = document.querySelector<HTMLSelectElement>('#model-select');
      if (tplSel) void refreshReasoningTagForModel(tplSel.value);

      section.classList.remove('hidden');
      scrollToBottom();

      requestAnimationFrame(() => {
        container
          .querySelector<HTMLTextAreaElement>('.turn-followup-input:not([disabled]):not(.is-followup-inactive)')
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

      const { row: qEl, timeTag } = createLiveTurnQueryRow(query, model, thinkingCapable);
      article.appendChild(qEl);

      const aEl = document.createElement('div');
      aEl.className = 'turn-answer markdown-body';

      const refWrap = createReferencesSection([]);
      refWrap.classList.add('hidden');

      const footer = createAnswerFooter();

      article.append(qEl, aEl, refWrap, footer);
      container.appendChild(article);
      section.classList.remove('hidden');
      scrollToBottom();

      // Live state
      let sources: SearchResult[] = [];
      let answerSnapshot = '';
      let thinkingSnapshot = '';
      let formulationModelSnapshot = '';
      let formulationThinkingCapableSnapshot = false;
      let formulationThinkingSnapshot = '';
      let formulationQueriesSnapshot: string[] = [];
      let researchPlanSnapshot: string[] = [];
      let liveThinking: { details: HTMLDetailsElement; body: HTMLElement } | null = null;
      let liveFormulation: HTMLElement | null = null;
      let liveResearchPlan: HTMLElement | null = null;

      // Ticker for generation time
      stopGenerationTicker = startGenerationTicker((label) => {
        timeTag.textContent = label;
      }).stop;

      function refreshFormulationDetails(): void {
        const hasData = formulationQueriesSnapshot.length > 0 || formulationThinkingSnapshot.trim().length > 0;
        if (!hasData) return;

        const next = createFormulationDetails({
          model: formulationModelSnapshot || undefined,
          thinkingCapable: formulationThinkingCapableSnapshot,
          thinkingRaw: formulationThinkingSnapshot.trim() || undefined,
          queries: formulationQueriesSnapshot,
        });

        if (liveFormulation) {
          liveFormulation.replaceWith(next);
        } else {
          article.insertBefore(next, aEl);
        }
        liveFormulation = next;
      }

      function refreshResearchPlanDetails(): void {
        if (researchPlanSnapshot.length === 0) return;
        const next = createResearchPlanDetails(researchPlanSnapshot);
        if (liveResearchPlan) {
          liveResearchPlan.replaceWith(next);
        } else {
          article.insertBefore(next, aEl);
        }
        liveResearchPlan = next;
      }

      const exportCtl = createExportButton(() => ({
        query,
        model,
        answerRaw: answerSnapshot,
        thinkingRaw: thinkingSnapshot.trim() || undefined,
        sources,
        researchPlan: researchPlanSnapshot.length > 0 ? [...researchPlanSnapshot] : undefined,
      }));
      footer.appendChild(exportCtl.button);

      return {
        setSources(results: SearchResult[]): void {
          sources = results;
          refWrap.replaceWith(createReferencesSection(results));
        },

        setAnswerMarkdown(raw: string): void {
          answerSnapshot = raw;
          aEl.innerHTML = renderAnswerMarkdown(raw, sources);
          exportCtl.refresh();
          scrollToBottom();
        },

        appendThinkingChunk(text: string): void {
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

        setFormulationMeta(formulationModel: string, thinkingCapable: boolean): void {
          formulationModelSnapshot = formulationModel.trim();
          formulationThinkingCapableSnapshot = thinkingCapable;
        },

        setFormulationQueries(queries: readonly string[]): void {
          formulationQueriesSnapshot = [...queries];
          refreshFormulationDetails();
          scrollToBottom();
        },

        appendFormulationThinkingChunk(text: string): void {
          if (!text) return;
          formulationThinkingSnapshot += text;
          refreshFormulationDetails();
          scrollToBottom();
        },

        setResearchPlan(steps: readonly string[]): void {
          researchPlanSnapshot = [...steps];
          refreshResearchPlanDetails();
          scrollToBottom();
        },
      };
    },

    scrollToBottom,
  };
}