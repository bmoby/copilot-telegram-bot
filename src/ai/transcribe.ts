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

export async function transcribeAudio(buffer: Buffer, filename: string, language: string = 'fr'): Promise<string> {
  const client = getOpenAI();

  logger.info({ filename, size: buffer.length, language }, 'Transcribing audio');

  const file = new File([new Uint8Array(buffer)], filename, { type: 'audio/ogg' });

  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language,
  });

  logger.info({ text: transcription.text.substring(0, 100) }, 'Transcription complete');
  return transcription.text;
}
