import type { SearchResult } from './searxng';

export interface ChatTurn {
  id: string;
  createdAt: number;
  query: string;
  answerRaw: string;
  sources: SearchResult[];
  model: string;
  error?: string;
}

export interface ChatRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

const KEY = 'archon-chats-v3';
const MAX_CHATS = 100;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isSearchResult(raw: unknown): raw is SearchResult {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.title !== 'string' ||
    typeof r.url !== 'string' ||
    typeof r.content !== 'string'
  ) {
    return false;
  }
  if (r.publishedDate !== undefined && typeof r.publishedDate !== 'string') {
    return false;
  }
  if (r.engine !== undefined && typeof r.engine !== 'string') return false;
  return true;
}

function isChatTurn(raw: unknown): raw is ChatTurn {
  if (raw === null || typeof raw !== 'object') return false;
  const t = raw as Record<string, unknown>;
  if (
    typeof t.id !== 'string' ||
    typeof t.createdAt !== 'number' ||
    typeof t.query !== 'string' ||
    typeof t.answerRaw !== 'string' ||
    typeof t.model !== 'string' ||
    !Array.isArray(t.sources) ||
    !t.sources.every(isSearchResult)
  ) {
    return false;
  }
  if (t.error !== undefined && typeof t.error !== 'string') return false;
  return true;
}

function parseChatRecord(raw: unknown): ChatRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (typeof o.createdAt !== 'number') return null;
  if (!Array.isArray(o.turns) || o.turns.length === 0) return null;
  if (!o.turns.every(isChatTurn)) return null;
  if (typeof o.updatedAt !== 'number') return null;
  const turns = o.turns as ChatTurn[];

  return {
    id: o.id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    turns,
  };
}

export function loadChats(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseChatRecord)
      .filter((c): c is ChatRecord => c !== null);
  } catch {
    return [];
  }
}

function saveChats(chats: ChatRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(chats));
}

export function getChatById(id: string): ChatRecord | undefined {
  return loadChats().find((c) => c.id === id);
}

export function chatTitle(chat: ChatRecord): string {
  return chat.turns[0]?.query?.trim() || 'Untitled';
}

export function chatHasError(chat: ChatRecord): boolean {
  return chat.turns.some((t) => t.error);
}

export function createTurn(
  partial: Omit<ChatTurn, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
  },
): ChatTurn {
  return {
    id: partial.id ?? generateId(),
    createdAt: partial.createdAt ?? Date.now(),
    query: partial.query,
    answerRaw: partial.answerRaw,
    sources: partial.sources,
    model: partial.model,
    error: partial.error,
  };
}

export function createNewChatWithTurn(turn: ChatTurn): ChatRecord {
  const rec: ChatRecord = {
    id: generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [turn],
  };
  const chats = loadChats();
  saveChats([rec, ...chats.filter((c) => c.id !== rec.id)].slice(0, MAX_CHATS));
  return rec;
}

export function appendTurnToChat(
  chatId: string,
  turn: ChatTurn,
): ChatRecord | null {
  const chats = loadChats();
  const idx = chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return null;

  const prev = chats[idx];
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
