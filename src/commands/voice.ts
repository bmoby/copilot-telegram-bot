import type { Bot, Context } from "grammy";
import { isAdmin } from "../utils/auth.js";
import { isVoiceMode, setVoiceMode } from "../utils/reply.js";
import { logger } from "../logger.js";

export function registerVoiceCommand(bot: Bot): void {
  bot.command("voice", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    try {
      const current = await isVoiceMode();
      const newMode = !current;

      await setVoiceMode(newMode);

      if (newMode) {
        await ctx.reply(
          "🔊 Голосовые ответы включены.\nТеперь буду отвечать голосом.\n\n/voice чтобы вернуться к тексту.",
        );
      } else {
        await ctx.reply(
          "🔇 Голосовые ответы выключены.\nТеперь отвечаю текстом.\n\n/voice чтобы снова включить голос.",
        );
      }
    } catch (error) {
      logger.error({ error }, "Failed to toggle voice mode");
      await ctx.reply("Ошибка при переключении режима. Попробуй ещё раз.");
    }
  });
}
