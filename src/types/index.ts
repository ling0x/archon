// =============================================================================
// Type Definitions
// =============================================================================

import type { ChatRecord, ChatTurn } from '../chatStorage';
import type { SearchResult } from '../searxng';

// Re-export for convenience
export type { ChatRecord, ChatTurn };

// Ollama Streaming
export interface OllamaStreamChunk {
  model: string;
  response: string;
  thinking?: string;
  done: boolean;
}

export type StreamChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'response'; text: string };

export type PriorTurn = { query: string; answer: string };

// UI Types
export type ComposerPhase = 'idle' | 'formulating' | 'searching' | 'thinking';

// Search Flow
export interface SearchFlowDeps {
  status: StatusBar;
  statusSlot: HTMLElement;
  conversation: ConversationView;
  history: ChatHistoryView;
  input: HTMLTextAreaElement;
  mainEl: HTMLElement;
  modelSelect: HTMLSelectElement;
  deepResearch: boolean;
}

export interface TurnUi {
  setSources: (results: SearchResult[]) => void;
  setAnswerMarkdown: (raw: string) => void;
  appendThinkingChunk: (text: string) => void;
  setFormulationMeta: (model: string, thinkingCapable: boolean) => void;
  setFormulationQueries: (queries: readonly string[]) => void;
  appendFormulationThinkingChunk: (text: string) => void;
  setResearchPlan: (steps: readonly string[]) => void;
}

export interface ConversationView {
  clear: () => void;
  show: () => void;
  hide: () => void;
  renderChat: (chat: ChatRecord) => void;
  startTurn: (query: string, model: string, opts?: { thinkingCapable?: boolean }) => TurnUi;
  scrollToBottom: () => void;
}

export interface ChatHistoryView {
  render: () => void;
  syncActive: () => void;
}

export interface StatusBar {
  setTarget: (el: HTMLElement) => void;
  set: (msg: string, isError?: boolean) => void;
  clear: () => void;
  clearAll: () => void;
}

export interface MobileSidebar {
  open: () => void;
  close: () => void;
  bind: () => void;
}

export interface ChatSessionController {
  applyRecord: (chat: ChatRecord) => void;
  beginNew: () => void;
  selectById: (id: string) => void;
}

// Formulation
export interface GapAnalysisResult {
  sufficient: boolean;
  followUpQueries: string[];
}

export interface DeepResearchPlanResult {
  plan: string[];
  queries: string[];
}

export interface StreamAnswerOptions {
  hasSearchResults: boolean;
  searchQueryUsed?: string;
  think?: boolean | 'low' | 'medium' | 'high';
  deepResearch?: boolean;
  intermediateResearchNotes?: string;
  twoPassSynthesis?: boolean;
}

export interface FormulationProgressHandlers {
  onThinkingChunk?: (text: string) => void;
  onResponseChunk?: (text: string) => void;
}

// API
export interface ExtractPagesResponse {
  pages: Record<string, { text?: string; error?: string }>;
}