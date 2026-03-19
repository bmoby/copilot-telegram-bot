import OpenAI from 'openai';
import { logger } from '../logger.js';

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (openai) return openai;
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
  openai = new OpenAI({ apiKey });
  return openai;
}

const MAX_TTS_LENGTH = 4096;

export async function textToSpeech(text: string): Promise<Buffer> {
  const client = getOpenAI();

  // Truncate if too long for TTS (keep it concise for voice)
  const truncated = text.length > MAX_TTS_LENGTH
    ? text.substring(0, MAX_TTS_LENGTH - 3) + '...'
    : text;

  logger.info({ textLength: truncated.length }, 'Generating TTS audio');

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'onyx',
    input: truncated,
    response_format: 'opus',
  });

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  logger.info({ audioSize: buffer.length }, 'TTS audio generated');
  return buffer;
}
