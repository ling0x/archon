import { renderAnswerMarkdown } from '../markdown';

export type AnswerPanel = {
  setFromMarkdown: (raw: string) => void;
  clear: () => void;
  showSection: () => void;
  hideSection: () => void;
};

export function createAnswerPanel(
  answerEl: HTMLElement,
  answerSec: HTMLElement,
): AnswerPanel {
  return {
    setFromMarkdown(raw: string) {
      answerEl.innerHTML = renderAnswerMarkdown(raw);
      answerSec.classList.remove('hidden');
    },
    clear() {
      answerEl.innerHTML = '';
    },
    showSection() {
      answerSec.classList.remove('hidden');
    },
    hideSection() {
      answerSec.classList.add('hidden');
    },
  };
}
