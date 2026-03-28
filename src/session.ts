let currentChatId: string | null = null;

export function getCurrentChatId(): string | null {
  return currentChatId;
}

export function setCurrentChatId(id: string | null): void {
  currentChatId = id;
}
