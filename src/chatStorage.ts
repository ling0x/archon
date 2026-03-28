import type { SearchResult } from './searxng';

export interface ChatTurn {
  id: string;
  createdAt: number;
  query: string;
  answerRaw: string;
  sources: SearchResult[];
  error?: string;
}

export interface ChatRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

/** @deprecated flat shape — migrated on load */
interface LegacyChatRecord {
  id: string;
  createdAt: number;
  query: string;
  answerRaw: string;
  sources: SearchResult[];
  error?: string;
}

const KEY = 'archon-chats-v1';
const MAX_CHATS = 100;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isLegacyRecord(x: unknown): x is LegacyChatRecord {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.query === 'string' &&
    !Array.isArray(o.turns)
  );
}

function migrateRecord(raw: unknown): ChatRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.turns)) {
    const turns = o.turns as ChatTurn[];
    if (!turns.length) return null;
    const lastTs = turns[turns.length - 1]?.createdAt;
    return {
      id: String(o.id),
      createdAt: Number(o.createdAt) || Date.now(),
      updatedAt:
        Number(o.updatedAt) || Number(lastTs) || Number(o.createdAt) || Date.now(),
      turns,
    };
  }

  if (isLegacyRecord(raw)) {
    const t: ChatTurn = {
      id: generateId(),
      createdAt: raw.createdAt,
      query: raw.query,
      answerRaw: raw.answerRaw,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      error: raw.error,
    };
    return {
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.createdAt,
      turns: [t],
    };
  }

  return null;
}

export function loadChats(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    let needsSave = false;
    const out: ChatRecord[] = [];
    for (const item of parsed) {
      if (isLegacyRecord(item)) needsSave = true;
      const rec = migrateRecord(item);
      if (rec) out.push(rec);
    }

    if (needsSave) saveChats(out);
    return out;
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
  partial: Omit<ChatTurn, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): ChatTurn {
  return {
    id: partial.id ?? generateId(),
    createdAt: partial.createdAt ?? Date.now(),
    query: partial.query,
    answerRaw: partial.answerRaw,
    sources: partial.sources,
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

export function appendTurnToChat(chatId: string, turn: ChatTurn): ChatRecord | null {
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
