import { createChatSessionController, type ChatSessionController } from './app/chatSession';
import { runSearch } from './app/searchFlow';
import { getAppElements } from './ui/dom';
import { createAnswerPanel } from './ui/answerPanel';
import { createChatHistoryView } from './ui/chatHistory';
import { createMobileSidebar } from './ui/sidebar';
import { createSourcesList } from './ui/sourcesList';
import { createStatusBar } from './ui/statusBar';

const el = getAppElements();

const status = createStatusBar(el.statusEl);
const answer = createAnswerPanel(el.answerEl, el.answerSec);
const sources = createSourcesList(el.sourcesEl, el.sourcesSec);

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
  answer,
  sources,
  history,
  onAfterNavigate: () => sidebar.close(),
});

el.newChatBtn.addEventListener('click', () => chatSession.beginNew());

sidebar.bind();

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = el.input.value.trim();
  if (!query) return;

  await runSearch(query, {
    status,
    answer,
    sources,
    submitBtn: el.submitBtn,
    btnLabel: el.btnLabel,
    history,
  });
});

history.render();
