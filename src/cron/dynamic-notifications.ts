import type { Bot } from 'grammy';
import {
  planDailyNotifications,
  getNotificationCount,
} from '../ai/notification-planner.js';
import {
  createReminders,
  getDueReminders,
  markReminderSent,
  cancelActiveReminders,
  getTodayReminders,
} from '../db/reminders.js';
import { getActiveTasks, getOverdueTasks } from '../db/tasks.js';
import { getDailyPlan, saveDailyPlan, initLivePlanFromStatic } from '../db/daily-plans.js';
import { generateDailyPlan } from '../ai/planner.js';
import { todayDateString, getDayOfWeek } from '../utils/format.js';
import { logger } from '../logger.js';

export async function ensureDailyPlan(): Promise<void> {
  const today = todayDateString();
  const existing = await getDailyPlan(today);

  if (existing?.live_plan) {
    logger.info('Daily live plan already exists, skipping generation');
    return;
  }

  try {
    const activeTasks = await getActiveTasks();
    const overdueTasks = await getOverdueTasks();

    const planTasks = await generateDailyPlan({
      activeTasks,
      overdueTasks,
      dayOfWeek: getDayOfWeek(),
      sportDoneRecently: false,
    });

    if (planTasks.length === 0) {
      logger.info('No tasks to plan for today');
      return;
    }

    const livePlan = initLivePlanFromStatic(planTasks);

    await saveDailyPlan({
      date: today,
      plan: planTasks,
      live_plan: livePlan,
      status: 'active',
      review: null,
      productivity_score: null,
      revision_count: 0,
      last_reorganized_at: null,
    });

    logger.info({ taskCount: livePlan.length }, 'Daily live plan auto-generated');
  } catch (error) {
    logger.error({ error }, 'Failed to auto-generate daily plan');
  }
}

export async function planDay(): Promise<number> {
  try {
    // Auto-generate the daily live plan
    await ensureDailyPlan();

    const cancelled = await cancelActiveReminders();
    if (cancelled > 0) {
      logger.info({ cancelled }, 'Cancelled stale notifications before replanning');
    }

    const count = await getNotificationCount();

    const planned = await planDailyNotifications(count);

    if (planned.length === 0) {
      logger.warn('Notification planner returned 0 notifications');
      return 0;
    }

    const today = new Date().toISOString().split('T')[0]!;
    const now = new Date();

    const reminders = planned
      .map((notif) => {
        const triggerDate = new Date(`${today}T${notif.time}:00`);
        return {
          message: notif.message,
          trigger_at: triggerDate.toISOString(),
          repeat: 'once' as const,
          repeat_config: { type: notif.type, planned_by: 'notification-planner' },
          channel: 'telegram' as const,
        };
      })
      .filter((r) => new Date(r.trigger_at) > now);

    if (reminders.length === 0) {
      logger.warn('All planned notifications are in the past');
      return 0;
    }

    await createReminders(reminders);

    logger.info({ stored: reminders.length, total: planned.length }, 'Daily notifications stored in DB');
    return reminders.length;
  } catch (error) {
    logger.error({ error }, 'Failed to plan daily notifications');
    return 0;
  }
}

export async function dispatchNotifications(bot: Bot, chatId: string): Promise<void> {
  try {
    const dueReminders = await getDueReminders();

    if (dueReminders.length === 0) return;

    logger.info({ count: dueReminders.length }, 'Dispatching due notifications');

    for (const reminder of dueReminders) {
      try {
        await bot.api.sendMessage(chatId, reminder.message);
        await markReminderSent(reminder.id);

        const config = reminder.repeat_config as Record<string, unknown> | null;
        logger.info(
          { id: reminder.id, type: config?.['type'] ?? 'unknown' },
          'Notification sent'
        );
      } catch (error) {
        logger.error({ error, reminderId: reminder.id }, 'Failed to send notification');
        await markReminderSent(reminder.id);
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to dispatch notifications');
  }
}

export async function getNotificationsSummary(): Promise<string> {
  const count = await getNotificationCount();
  const reminders = await getTodayReminders();

  const active = reminders.filter((r) => r.status === 'active');
  const sent = reminders.filter((r) => r.status === 'sent');

  let summary = `Notifications aujourd'hui : ${count}/jour\n\n`;
  summary += `Envoyees : ${sent.length}\n`;
  summary += `En attente : ${active.length}\n`;

  if (active.length > 0) {
    summary += `\nProchaines :\n`;
    for (const r of active.slice(0, 5)) {
      const time = new Date(r.trigger_at).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const config = r.repeat_config as Record<string, unknown> | null;
      const type = config?.['type'] ?? '';
      summary += `  ${time} [${type}] ${r.message.slice(0, 60)}${r.message.length > 60 ? '...' : ''}\n`;
    }
    if (active.length > 5) {
      summary += `  ... et ${active.length - 5} autres\n`;
    }
  }

  return summary;
}
