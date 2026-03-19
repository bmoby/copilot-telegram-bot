import { logger } from '../logger.js';
import type { Context } from 'grammy';

export function isAdmin(ctx: Context): boolean {
  const adminChatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!adminChatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set, allowing all users');
    return true;
  }
  return ctx.chat?.id.toString() === adminChatId;
}

export function getAdminChatId(): string {
  const adminChatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!adminChatId) {
    throw new Error('TELEGRAM_ADMIN_CHAT_ID not set');
  }
  return adminChatId;
}
