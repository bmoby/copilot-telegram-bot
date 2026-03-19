import type { Bot } from 'grammy';
import * as scheduler from '../scheduler/index.js';
import { expireZombieReminders } from '../db/reminders.js';
import { runMemoryConsolidation } from '../ai/memory-consolidator.js';
import { logger } from '../logger.js';
import { planDay, dispatchNotifications } from './dynamic-notifications.js';

export function registerCronJobs(bot: Bot): void {
  const chatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set, skipping cron jobs');
    return;
  }

  // Memory consolidation — 03:00 every day
  scheduler.registerJob('memory-consolidation', '0 3 * * *', async () => {
    const result = await runMemoryConsolidation();
    logger.info(result, 'Memory consolidation completed');
  });

  // Zombie reminder cleanup — 06:55 every day
  scheduler.registerJob('zombie-reminder-cleanup', '55 6 * * *', async () => {
    const count = await expireZombieReminders();
    logger.info({ expired: count }, 'Zombie reminder cleanup completed');
  });

  // Daily planning — 07:00 every day
  scheduler.registerJob('daily-notification-plan', '0 7 * * *', async () => {
    const count = await planDay();
    logger.info({ count }, 'Daily notification plan completed');
  });

  // Notification dispatcher — every 2 minutes
  scheduler.registerJob('notification-dispatcher', '*/2 * * * *', () =>
    dispatchNotifications(bot, chatId)
  );

  // Start all jobs
  scheduler.startAllJobs();
  logger.info('Cron system started (consolidation: 03:00, zombies: 06:55, plan: 07:00, dispatch: every 2min)');
}
