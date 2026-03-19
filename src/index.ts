import dotenv from 'dotenv';
dotenv.config();

import { Bot } from 'grammy';
import { logger } from './logger.js';
import { registerCommands } from './commands/index.js';
import { registerVoiceHandler } from './handlers/voice.js';
import { registerFreeText } from './handlers/free-text.js';
import { registerCronJobs } from './cron/index.js';

const token = process.env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
}

const bot = new Bot(token);

// Register command handlers
registerCommands(bot);

// Register voice message handler
registerVoiceHandler(bot);

// Register free text handler (must be last)
registerFreeText(bot);

// Start cron jobs
registerCronJobs(bot);

// Error handling
bot.catch((err) => {
  logger.error({ error: err.error, ctx: err.ctx?.update }, 'Bot error');
});

// Start the bot
logger.info('Starting Copilot bot...');
bot.start({
  onStart: () => {
    logger.info('Copilot bot is running');
  },
});
