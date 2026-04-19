// =============================================================================
// Chat Storage
// =============================================================================

import type { SearchResult } from './searxng';

export interface ChatTurn {
  id: string;
  createdAt: number;
  query: string;
  answerRaw: string;
  thinkingRaw?: string;
  thinkingCapable?: boolean;
  formulationModel?: string;
  formulationThinkingCapable?: boolean;
  formulationThinkingRaw?: string;
  formulationQueries?: string[];
  researchPlan?: string[];
  researchNotesRaw?: string;
  deepResearch?: boolean;
  sources: SearchResult[];
  model: string;
  generationMs: number;
  error?: string;
}

export interface ChatRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

const STORAGE_KEY = 'archon-chats';
const MAX_CHATS = 100;

// =============================================================================
// ID Generation
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// =============================================================================
// Basic Validation
// =============================================================================

function isSearchResult(raw: unknown): raw is SearchResult {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.title === 'string' &&
    typeof r.url === 'string' &&
    typeof r.content === 'string'
  );
}

function isChatTurn(raw: unknown): raw is ChatTurn {
  if (raw === null || typeof raw !== 'object') return false;
  const t = raw as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.createdAt === 'number' &&
    typeof t.query === 'string' &&
    typeof t.answerRaw === 'string' &&
    typeof t.model === 'string' &&
    typeof t.generationMs === 'number' &&
    Array.isArray(t.sources) &&
    t.sources.every(isSearchResult)
  );
}

function isChatRecord(raw: unknown): raw is ChatRecord {
  if (raw === null || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number' &&
    Array.isArray(o.turns) &&
    o.turns.every(isChatTurn)
  );
}

// =============================================================================
// Storage Operations
// =============================================================================

export function loadChats(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isChatRecord)
      .slice(0, MAX_CHATS);
  } catch {
    return [];
  }
}

function saveChats(chats: ChatRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

export function getChatById(id: string): ChatRecord | undefined {
  return loadChats().find((c) => c.id === id);
}

// =============================================================================
// Chat Helpers
// =============================================================================

export function chatTitle(chat: ChatRecord): string {
  const q = chat.turns[0]?.query.trim();
  return q || 'Untitled';
}

export function chatHasError(chat: ChatRecord): boolean {
  return chat.turns.some((t) => t.error);
}

// =============================================================================
// Turn Operations
// =============================================================================

export function createTurn(fields: Omit<ChatTurn, 'id' | 'createdAt'>): ChatTurn {
  return {
    id: generateId(),
    createdAt: Date.now(),
    ...fields,
  };
}

export function createNewChatWithTurn(turn: ChatTurn): ChatRecord {
  const rec: ChatRecord = {
    id: generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [turn],
  };

  saveChats([rec, ...loadChats()].slice(0, MAX_CHATS));
  return rec;
}

export function appendTurnToChat(chatId: string, turn: ChatTurn): ChatRecord | null {
  const chats = loadChats();
  const idx = chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return null;

  const prev = chats[idx]!;
  const updated: ChatRecord = {
    ...prev,
    updatedAt: Date.now(),
    turns: [...prev.turns, turn],
  };

  const next = [...chats];
  next[idx] = updated;
  saveChats(next);
  return updated;
}

// =============================================================================
// Delete Chat
// =============================================================================

export function deleteChat(chatId: string): boolean {
  const chats = loadChats();
  const idx = chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return false;

  const next = [...chats];
  next.splice(idx, 1);
  saveChats(next);
  return true;
}