import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import { textToSpeech } from '../ai/tts.js';
import { getMemoryEntry, upsertMemory } from '../db/memory.js';
import { logger } from '../logger.js';

const TELEGRAM_MAX_LENGTH = 4096;

// In-memory cache — loaded from DB on first call, updated by /voice
let voiceModeCache: boolean | null = null;

export async function isVoiceMode(): Promise<boolean> {
  if (voiceModeCache !== null) return voiceModeCache;

  // First call: load from DB
  try {
    const entry = await getMemoryEntry('preference', 'voice_responses');
    voiceModeCache = entry?.content === 'true';
  } catch {
    // DB not ready yet or no entry — check env var fallback
    voiceModeCache = process.env['VOICE_RESPONSES'] === 'true';
  }
  return voiceModeCache;
}

export async function setVoiceMode(enabled: boolean): Promise<void> {
  voiceModeCache = enabled;
  await upsertMemory({
    category: 'preference',
    key: 'voice_responses',
    content: String(enabled),
    source: 'commande_voice',
  });
}

export async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  const paragraphs = text.split('\n\n');
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > TELEGRAM_MAX_LENGTH) {
      if (current.trim()) await ctx.reply(current.trim());
      if (paragraph.length > TELEGRAM_MAX_LENGTH) {
        const lines = paragraph.split('\n');
        current = '';
        for (const line of lines) {
          if (current.length + line.length + 1 > TELEGRAM_MAX_LENGTH) {
            if (current.trim()) await ctx.reply(current.trim());
            current = line + '\n';
          } else {
            current += line + '\n';
          }
        }
      } else {
        current = paragraph + '\n\n';
      }
    } else {
      current += paragraph + '\n\n';
    }
  }

  if (current.trim()) await ctx.reply(current.trim());
}

/**
 * Send response as voice message.
 * Falls back to text if TTS fails or text is too long (research reports).
 */
export async function sendVoiceReply(ctx: Context, text: string): Promise<void> {
  // For very long texts (research reports), voice doesn't make sense — send text
  if (text.length > 4096) {
    await sendLongMessage(ctx, text);
    return;
  }

  try {
    const audioBuffer = await textToSpeech(text);
    await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.ogg'));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, 'TTS failed, falling back to text');
    await ctx.reply(text);
  }
}

/**
 * Smart reply: voice or text depending on user preference.
 */
export async function smartReply(ctx: Context, text: string): Promise<void> {
  const voice = await isVoiceMode();
  if (voice) {
    await sendVoiceReply(ctx, text);
  } else {
    await ctx.reply(text);
  }
}
