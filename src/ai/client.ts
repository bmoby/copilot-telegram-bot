import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.js';

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (anthropic) return anthropic;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  anthropic = new Anthropic({ apiKey });
  logger.info('Anthropic client initialized');
  return anthropic;
}

export type ModelChoice = 'sonnet' | 'opus';

const MODEL_MAP: Record<ModelChoice, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

export async function askClaude(params: {
  prompt: string;
  systemPrompt?: string;
  model?: ModelChoice;
  maxTokens?: number;
}): Promise<string> {
  const client = getClient();
  const model = MODEL_MAP[params.model ?? 'sonnet'];

  logger.debug({ model, promptLength: params.prompt.length }, 'Calling Claude API');

  const message = await client.messages.create({
    model,
    max_tokens: params.maxTokens ?? 4096,
    system: params.systemPrompt ?? undefined,
    messages: [{ role: 'user', content: params.prompt }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  logger.debug(
    { model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    'Claude API response received'
  );

  return textBlock.text;
}
