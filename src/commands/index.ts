import type { Bot } from "grammy";
import { registerPlanCommand } from "./plan.js";
import { registerTaskCommands } from "./tasks.js";
import { registerClientCommands } from "./clients.js";
import { registerNotifsCommand } from "./notifs.js";
import { registerVoiceCommand } from "./voice.js";
import { config } from "../config.js";
import { isAdmin } from "../utils/auth.js";
import { needsOnboarding, startOnboarding } from "../ai/onboarding.js";
import { logger } from "../logger.js";

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply("Этот бот приватный.");
      return;
    }

    try {
      const shouldOnboard = await needsOnboarding();
      if (shouldOnboard) {
        const chatId = String(ctx.chat?.id);
        const question = startOnboarding(chatId);
        await ctx.reply(question);
        return;
      }
    } catch (error) {
      logger.error({ error }, "Onboarding check failed, showing default start");
    }

    await ctx.reply(
      `Привет! Я — твой ${config.botName}.\n\nКоманды:\n` +
        `/plan — План дня\n` +
        `/next — Следующая задача\n` +
        `/done — Отметить как выполнено\n` +
        `/add [текст] — Добавить задачу\n` +
        `/tasks — Все задачи\n` +
        `/skip — Пропустить задачу\n` +
        `/clients — Воронка клиентов\n` +
        `/client [имя] — Детали клиента\n` +
        `/newclient [имя] — [потребность] — [бюджет]\n` +
        `/notifs — Посмотреть/настроить уведомления (пр: /notifs 20)\n` +
        `/replan — Перепланировать уведомления\n` +
        `/voice — Вкл/выкл голосовые ответы\n\n` +
        `Или просто отправь сообщение, я пойму.`,
    );
  });

  registerPlanCommand(bot);
  registerTaskCommands(bot);
  registerClientCommands(bot);
  registerNotifsCommand(bot);
  registerVoiceCommand(bot);
}
