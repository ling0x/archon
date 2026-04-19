import { createChatSessionController } from './app/chatSession';
import type { ChatSessionController } from './types';
import { runSearch } from './app/searchFlow';
import { createConversationView } from './ui/conversation';
import { getAppElements } from './ui/dom';
import { createChatHistoryView } from './ui/chatHistory';
import { createMobileSidebar } from './ui/sidebar';
import { createStatusBar, statusSlotForSubmittedForm } from './ui/statusBar';
import { initModelSelect } from './modelPicker';
import { initTheme, syncThemeToggleButton, toggleTheme } from './theme';
import { getFormDataFromSubmitEvent } from './hooks/form';
import { syncDeepResearchToggle } from './hooks/deepResearch';

// =============================================================================
// Theme Initialization
// =============================================================================

const theme = initTheme();
const { themeToggleBtn } = getAppElements();
syncThemeToggleButton(themeToggleBtn, theme);
themeToggleBtn.addEventListener('click', () => {
  syncThemeToggleButton(themeToggleBtn, toggleTheme());
});

// =============================================================================
// UI Components
// =============================================================================

const { statusEl, mainEl, conversationEl, conversationSec } = getAppElements();
const status = createStatusBar(statusEl, mainEl);
const conversation = createConversationView(conversationEl, conversationSec);

const sidebar = createMobileSidebar({
  appShell: getAppElements().appShell,
  backdrop: getAppElements().sidebarBackdrop,
  toggleBtn: getAppElements().sidebarOpenBtn,
});

// =============================================================================
// Deep Research Toggle Sync
// =============================================================================

syncDeepResearchToggle(mainEl);

// =============================================================================
// Chat History
// =============================================================================

let chatSession: ChatSessionController;

const history = createChatHistoryView({
  listEl: getAppElements().chatHistoryEl,
  onSelect: (id) => chatSession.selectById(id),
});

// =============================================================================
// Chat Session Controller
// =============================================================================

const elements = getAppElements();
chatSession = createChatSessionController({
  input: elements.input,
  status,
  mainStatusSlot: elements.statusEl,
  conversation,
  history,
  mainEl: elements.mainEl,
  onAfterNavigate: () => sidebar.close(),
});

elements.newChatBtn.addEventListener('click', () => chatSession.beginNew());
sidebar.bind();

// Handle chat deletion (when active chat is deleted)
getAppElements().chatHistoryEl.addEventListener('chat-deleted', () => {
  chatSession.beginNew();
});

// =============================================================================
// Form Submission Handler
// =============================================================================

mainEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const formData = getFormDataFromSubmitEvent(form, elements.input);
  if (!formData) return;

  const statusSlot = statusSlotForSubmittedForm(form, statusEl);
  const deepToggle = form.querySelector<HTMLInputElement>('.archon-deep-toggle');
  const deepResearch = deepToggle?.checked ?? false;

  status.setTarget(statusSlot);

  await runSearch(formData.query, {
    status,
    statusSlot,
    conversation,
    history,
    input: formData.input,
    mainEl,
    modelSelect: elements.modelSelect,
    deepResearch,
  });

  formData.input.value = '';
});

history.render();
void initModelSelect(getAppElements().modelSelect, mainEl);