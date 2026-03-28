import type { SearchResult } from './searxng';

export interface ChatRecord {
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

export function loadChats(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChats(chats: ChatRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(chats));
}

export function prependChat(
  partial: Omit<ChatRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): ChatRecord {
  const chats = loadChats();
  const rec: ChatRecord = {
    id: partial.id ?? generateId(),
    createdAt: partial.createdAt ?? Date.now(),
    query: partial.query,
    answerRaw: partial.answerRaw,
    sources: partial.sources,
    error: partial.error,
  };
  const next = [rec, ...chats.filter((c) => c.id !== rec.id)].slice(0, MAX_CHATS);
  saveChats(next);
  return rec;
}
