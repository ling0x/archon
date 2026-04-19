// =============================================================================
// Follow-up Composer Slot
// =============================================================================

import { getSelectedModel, refreshReasoningTagForModel } from '../../modelPicker';

function cloneModelSelectOptions(from: HTMLSelectElement, to: HTMLSelectElement): void {
  to.innerHTML = from.innerHTML;
  to.value = from.value;
}

export function createFollowupSlot(isLast: boolean): HTMLElement {
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

  const tplDeep = document.querySelector<HTMLElement>('#search-form .deep-research-field');
  if (tplDeep) {
    const deepEl = tplDeep.cloneNode(true) as HTMLElement;
    const inp = deepEl.querySelector<HTMLInputElement>('.archon-deep-toggle');
    inp?.removeAttribute('id');
    if (!isLast) {
      deepEl.classList.add('is-followup-inactive');
      inp?.classList.add('is-followup-inactive');
    }
    const mainToggle = document.querySelector<HTMLInputElement>('#deep-research-toggle');
    if (inp && mainToggle) inp.checked = mainToggle.checked;
    modelCluster.appendChild(deepEl);
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