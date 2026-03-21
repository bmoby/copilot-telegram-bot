import type { Bot, Context } from "grammy";
import {
  getClientPipeline,
  createClient,
  searchClientByName,
} from "../db/clients.js";
import { isAdmin } from "../utils/auth.js";

const STATUS_EMOJI: Record<string, string> = {
  lead: "🔵",
  qualified: "🟡",
  proposal_sent: "📨",
  accepted: "🟢",
  in_progress: "🔧",
  delivered: "📦",
  paid: "✅",
};

export function registerClientCommands(bot: Bot): void {
  bot.command("clients", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const clients = await getClientPipeline();
    if (clients.length === 0) {
      await ctx.reply("Нет клиентов в воронке.");
      return;
    }

    const lines = clients.map((c) => {
      const emoji = STATUS_EMOJI[c.status] ?? "⚪";
      const need = c.need ? ` — ${c.need}` : "";
      const budget = c.budget_range ? ` (${c.budget_range})` : "";
      return `${emoji} ${c.name}${need}${budget} [${c.status}]`;
    });

    await ctx.reply(
      `💼 Воронка клиентов (${clients.length}):\n\n${lines.join("\n")}`,
    );
  });

  bot.command("client", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const name = ctx.match?.toString().trim();
    if (!name) {
      await ctx.reply("Использование: /client [имя]");
      return;
    }

    const results = await searchClientByName(name);
    if (results.length === 0) {
      await ctx.reply(`Клиент "${name}" не найден.`);
      return;
    }

    const client = results[0]!;
    const emoji = STATUS_EMOJI[client.status] ?? "⚪";

    let message = `${emoji} ${client.name}\n`;
    message += `Статус: ${client.status}\n`;
    if (client.source) message += `Источник: ${client.source}\n`;
    if (client.business_type) message += `Сфера: ${client.business_type}\n`;
    if (client.need) message += `Потребность: ${client.need}\n`;
    if (client.budget_range) message += `Бюджет: ${client.budget_range}\n`;
    if (client.phone) message += `Тел: ${client.phone}\n`;
    if (client.notes) message += `Заметки: ${client.notes}\n`;

    await ctx.reply(message);
  });

  bot.command("newclient", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const text = ctx.match?.toString().trim();
    if (!text) {
      await ctx.reply(
        "Использование: /newclient [имя] — [потребность] — [бюджет]",
      );
      return;
    }

    const parts = text.split("—").map((p) => p.trim());
    const name = parts[0];
    if (!name) {
      await ctx.reply(
        "Использование: /newclient [имя] — [потребность] — [бюджет]",
      );
      return;
    }

    const client = await createClient({
      name,
      need: parts[1] ?? null,
      budget_range: parts[2] ?? null,
      source: "telegram",
      status: "lead",
    });

    await ctx.reply(
      `✅ Новый лид создан:\n\n💼 ${client.name}\nПотребность: ${client.need ?? "не указана"}\nБюджет: ${client.budget_range ?? "не указан"}\nСтатус: lead`,
    );
  });
}
