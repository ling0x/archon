import { createChatSessionController, type ChatSessionController } from './app/chatSession';
import { runSearch } from './app/searchFlow';
import { createConversationView } from './ui/conversation';
import { getAppElements } from './ui/dom';
import { createChatHistoryView } from './ui/chatHistory';
import { createMobileSidebar } from './ui/sidebar';
import { createStatusBar, statusSlotForSubmittedForm } from './ui/statusBar';
import { initModelSelect } from './modelPicker';

const el = getAppElements();

const status = createStatusBar(el.statusEl, el.mainEl);
const conversation = createConversationView(el.conversationEl, el.conversationSec);

const sidebar = createMobileSidebar({
  appShell: el.appShell,
  backdrop: el.sidebarBackdrop,
  toggleBtn: el.sidebarOpenBtn,
});

let chatSession: ChatSessionController;

const history = createChatHistoryView({
  listEl: el.chatHistoryEl,
  onSelect: (id) => chatSession.selectById(id),
});

chatSession = createChatSessionController({
  input: el.input,
  status,
  mainStatusSlot: el.statusEl,
  conversation,
  history,
  mainEl: el.mainEl,
  onAfterNavigate: () => sidebar.close(),
});

el.newChatBtn.addEventListener('click', () => chatSession.beginNew());

sidebar.bind();

function getQueryFromForm(form: HTMLFormElement): {
  input: HTMLTextAreaElement;
  query: string;
} | null {
  if (form.id === 'search-form') {
    const q = el.input.value.trim();
    return q ? { input: el.input, query: q } : null;
  }
  if (form.classList.contains('turn-followup')) {
    const input = form.querySelector<HTMLTextAreaElement>('.turn-followup-input');
    if (!input || input.disabled || input.classList.contains('is-followup-inactive')) {
      return null;
    }
    const q = input.value.trim();
    return q ? { input, query: q } : null;
  }
  return null;
}

el.mainEl.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id !== 'search-form' && !form.classList.contains('turn-followup')) {
    return;
  }
  e.preventDefault();

  const parsed = getQueryFromForm(form);
  if (!parsed) return;

  const statusSlot = statusSlotForSubmittedForm(form, el.statusEl);

  await runSearch(parsed.query, {
    status,
    statusSlot,
    conversation,
    history,
    input: el.input,
    mainEl: el.mainEl,
    modelSelect: el.modelSelect,
  });

  parsed.input.value = '';
});

history.render();
void initModelSelect(el.modelSelect, el.mainEl);
