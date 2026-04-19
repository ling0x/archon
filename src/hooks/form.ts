/**
 * Extract query and input element from form submission.
 * Handles both main search form and follow-up forms.
 */

export function getFormDataFromSubmitEvent(
  form: HTMLFormElement,
  mainInput: HTMLTextAreaElement,
): { input: HTMLTextAreaElement; query: string } | null {
  if (form.id === 'search-form') {
    const query = mainInput.value.trim();
    return query ? { input: mainInput, query } : null;
  }

  if (form.classList.contains('turn-followup')) {
    const input = form.querySelector<HTMLTextAreaElement>('.turn-followup-input');
    if (!input || input.disabled || input.classList.contains('is-followup-inactive')) {
      return null;
    }
    const query = input.value.trim();
    return query ? { input, query } : null;
  }

  return null;
}

/**
 * Handle Enter key in composer inputs.
 * Enter submits, Shift+Enter inserts newline (IME-safe).
 */
export function setupComposerKeydown(container: HTMLElement): void {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing) return;

    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (!target.classList.contains('composer-input')) return;
    if (target.disabled || target.classList.contains('is-followup-inactive')) return;

    e.preventDefault();
    if (!target.value.trim()) return;

    const form = target.form;
    if (form && (form.id === 'search-form' || form.classList.contains('turn-followup'))) {
      form.requestSubmit();
    }
  });
}