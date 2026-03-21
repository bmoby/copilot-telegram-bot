import type { Bot, Context } from "grammy";
import { upsertMemory } from "../db/memory.js";
import { logger } from "../logger.js";
import { isAdmin } from "../utils/auth.js";
import {
  planDay,
  getNotificationsSummary,
} from "../cron/dynamic-notifications.js";

export function registerNotifsCommand(bot: Bot): void {
  bot.command("notifs", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const arg = ctx.match?.toString().trim();

    if (!arg) {
      try {
        const summary = await getNotificationsSummary();
        await ctx.reply(summary);
      } catch (error) {
        logger.error({ error }, "Failed to get notifications summary");
        await ctx.reply("Ошибка при чтении уведомлений.");
      }
      return;
    }

    const newCount = parseInt(arg, 10);
    if (isNaN(newCount) || newCount < 1 || newCount > 50) {
      await ctx.reply("Использование: /notifs [1-50]\nПример: /notifs 20");
      return;
    }

    try {
      await upsertMemory({
        category: "preference",
        key: "notifications_par_jour",
        content: `${newCount} уведомлений в день`,
        source: "команда_notifs",
      });

      await ctx.reply(
        `Количество уведомлений: ${newCount}/день\n\nПерепланирование...`,
      );

      const planned = await planDay();

      await ctx.reply(`${planned} уведомлений запланировано на остаток дня.`);
    } catch (error) {
      logger.error({ error }, "Failed to update notification count");
      await ctx.reply("Ошибка при обновлении. Попробуй ещё раз.");
    }
  });

  bot.command("replan", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    try {
      await ctx.reply("Перепланирование...");
      const planned = await planDay();
      await ctx.reply(`${planned} уведомлений перепланировано на остаток дня.`);
    } catch (error) {
      logger.error({ error }, "Failed to replan notifications");
      await ctx.reply("Ошибка при перепланировании.");
    }
  });
}
