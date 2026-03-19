import { config } from '../config.js';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const conversations = new Map<string, Message[]>();
const MAX_MESSAGES = 20;
const TTL_MS = 60 * 60 * 1000; // 1 hour

export function addMessage(chatId: string, role: 'user' | 'assistant', text: string): void {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  const history = conversations.get(chatId)!;
  history.push({ role, text, timestamp: Date.now() });

  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }
}

export function getHistory(chatId: string): Message[] {
  const history = conversations.get(chatId);
  if (!history) return [];

  const now = Date.now();
  const fresh = history.filter((m) => now - m.timestamp < TTL_MS);

  if (fresh.length !== history.length) {
    conversations.set(chatId, fresh);
  }

  return fresh;
}

export function formatHistoryForPrompt(chatId: string): string {
  const history = getHistory(chatId);
  if (history.length === 0) return '';

  return history
    .map((m) => `${m.role === 'user' ? config.ownerName : config.botName}: ${m.text}`)
    .join('\n');
}
