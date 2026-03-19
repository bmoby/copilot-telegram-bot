import type { Bot } from 'grammy';
import { registerPlanCommand } from './plan.js';
import { registerTaskCommands } from './tasks.js';
import { registerClientCommands } from './clients.js';
import { registerNotifsCommand } from './notifs.js';
import { registerVoiceCommand } from './voice.js';
import { config } from '../config.js';
import { isAdmin } from '../utils/auth.js';
import { needsOnboarding, startOnboarding } from '../ai/onboarding.js';
import { logger } from '../logger.js';

export function registerCommands(bot: Bot): void {
  bot.command('start', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('Ce bot est prive.');
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
      logger.error({ error }, 'Onboarding check failed, showing default start');
    }

    await ctx.reply(
      `Salut ! Je suis ton ${config.botName}.\n\nCommandes :\n` +
        `/plan — Plan du jour\n` +
        `/next — Prochaine tache\n` +
        `/done — Marquer comme fait\n` +
        `/add [texte] — Ajouter une tache\n` +
        `/tasks — Toutes les taches\n` +
        `/skip — Passer la tache\n` +
        `/clients — Pipeline clients\n` +
        `/client [nom] — Details client\n` +
        `/newclient [nom] — [besoin] — [budget]\n` +
        `/notifs — Voir/regler les notifications (ex: /notifs 20)\n` +
        `/replan — Replanifier les notifications\n` +
        `/voice — Activer/desactiver les reponses vocales\n\n` +
        `Ou envoie un message libre, je comprendrai.`
    );
  });

  registerPlanCommand(bot);
  registerTaskCommands(bot);
  registerClientCommands(bot);
  registerNotifsCommand(bot);
  registerVoiceCommand(bot);
}
