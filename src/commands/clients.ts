import type { Bot, Context } from 'grammy';
import { getClientPipeline, createClient, searchClientByName } from '../db/clients.js';
import { isAdmin } from '../utils/auth.js';

const STATUS_EMOJI: Record<string, string> = {
  lead: '🔵',
  qualified: '🟡',
  proposal_sent: '📨',
  accepted: '🟢',
  in_progress: '🔧',
  delivered: '📦',
  paid: '✅',
};

export function registerClientCommands(bot: Bot): void {
  bot.command('clients', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const clients = await getClientPipeline();
    if (clients.length === 0) {
      await ctx.reply('Aucun client dans le pipeline.');
      return;
    }

    const lines = clients.map((c) => {
      const emoji = STATUS_EMOJI[c.status] ?? '⚪';
      const need = c.need ? ` — ${c.need}` : '';
      const budget = c.budget_range ? ` (${c.budget_range})` : '';
      return `${emoji} ${c.name}${need}${budget} [${c.status}]`;
    });

    await ctx.reply(`💼 Pipeline clients (${clients.length}) :\n\n${lines.join('\n')}`);
  });

  bot.command('client', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const name = ctx.match?.toString().trim();
    if (!name) {
      await ctx.reply('Usage : /client [nom]');
      return;
    }

    const results = await searchClientByName(name);
    if (results.length === 0) {
      await ctx.reply(`Aucun client trouve pour "${name}".`);
      return;
    }

    const client = results[0]!;
    const emoji = STATUS_EMOJI[client.status] ?? '⚪';

    let message = `${emoji} ${client.name}\n`;
    message += `Statut : ${client.status}\n`;
    if (client.source) message += `Source : ${client.source}\n`;
    if (client.business_type) message += `Metier : ${client.business_type}\n`;
    if (client.need) message += `Besoin : ${client.need}\n`;
    if (client.budget_range) message += `Budget : ${client.budget_range}\n`;
    if (client.phone) message += `Tel : ${client.phone}\n`;
    if (client.notes) message += `Notes : ${client.notes}\n`;

    await ctx.reply(message);
  });

  bot.command('newclient', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const text = ctx.match?.toString().trim();
    if (!text) {
      await ctx.reply('Usage : /newclient [nom] — [besoin] — [budget]');
      return;
    }

    const parts = text.split('—').map((p) => p.trim());
    const name = parts[0];
    if (!name) {
      await ctx.reply('Usage : /newclient [nom] — [besoin] — [budget]');
      return;
    }

    const client = await createClient({
      name,
      need: parts[1] ?? null,
      budget_range: parts[2] ?? null,
      source: 'telegram',
      status: 'lead',
    });

    await ctx.reply(
      `✅ Nouveau lead cree :\n\n💼 ${client.name}\nBesoin : ${client.need ?? 'non precise'}\nBudget : ${client.budget_range ?? 'non precise'}\nStatut : lead`
    );
  });
}
