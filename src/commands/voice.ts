import type { Bot, Context } from 'grammy';
import { isAdmin } from '../utils/auth.js';
import { isVoiceMode, setVoiceMode } from '../utils/reply.js';
import { logger } from '../logger.js';

export function registerVoiceCommand(bot: Bot): void {
  bot.command('voice', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    try {
      const current = await isVoiceMode();
      const newMode = !current;

      await setVoiceMode(newMode);

      if (newMode) {
        await ctx.reply('🔊 Reponses vocales activees.\nJe te parlerai en vocal maintenant.\n\n/voice pour repasser en texte.');
      } else {
        await ctx.reply('🔇 Reponses vocales desactivees.\nJe reponds en texte maintenant.\n\n/voice pour reactiver le vocal.');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to toggle voice mode');
      await ctx.reply('Erreur lors du changement de mode. Reessaie.');
    }
  });
}
