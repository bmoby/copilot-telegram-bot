import type { Bot, Context } from 'grammy';
import {
  getNextTask,
  getActiveTasks,
  completeTask,
  createTask,
} from '../db/tasks.js';
import type { Task } from '../types/index.js';
import { formatTask, formatTaskList } from '../utils/format.js';
import { isAdmin } from '../utils/auth.js';

export function registerTaskCommands(bot: Bot): void {
  bot.command('next', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const task = await getNextTask();
    if (!task) {
      await ctx.reply('Aucune tache en attente. Profite de ce moment de calme !');
      return;
    }

    const time = task.estimated_minutes ? `\nTemps estime : ${task.estimated_minutes} min` : '';
    await ctx.reply(
      `➡️ Prochaine tache :\n\n${formatTask(task)}${time}\n\nJuste celle-la. Rien d'autre.\n\n/done quand c'est fait.`
    );
  });

  bot.command('tasks', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const tasks = await getActiveTasks();
    await ctx.reply(`📋 Taches actives (${tasks.length}) :\n\n${formatTaskList(tasks)}`);
  });

  bot.command('done', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const arg = ctx.match?.toString().trim();

    let completedTask: Task;

    if (arg) {
      const index = parseInt(arg, 10);
      if (isNaN(index)) {
        await ctx.reply('Usage : /done [numero] ou /done (pour la tache en cours)');
        return;
      }
      const tasks = await getActiveTasks();
      const task = tasks[index - 1];
      if (!task) {
        await ctx.reply(`Tache #${index} introuvable.`);
        return;
      }
      completedTask = await completeTask(task.id);
    } else {
      const task = await getNextTask();
      if (!task) {
        await ctx.reply('Aucune tache a completer.');
        return;
      }
      completedTask = await completeTask(task.id);
    }

    const next = await getNextTask();
    let message = `✅ Fait : ${completedTask.title}\n\nBravo !`;

    if (next) {
      message += `\n\n➡️ Prochaine tache :\n${formatTask(next)}`;
    } else {
      message += '\n\n🎉 Plus aucune tache ! Tu as tout fait.';
    }

    await ctx.reply(message);
  });

  bot.command('add', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const text = ctx.match?.toString().trim();
    if (!text) {
      await ctx.reply('Usage : /add [description de la tache]');
      return;
    }

    const task = await createTask({
      title: text,
      source: 'telegram',
      category: 'personal',
      priority: 'normal',
      status: 'todo',
    });

    await ctx.reply(`✅ Tache ajoutee : ${task.title}\n\nCategorie : ${task.category}\nPriorite : ${task.priority}`);
  });

  bot.command('skip', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const tasks = await getActiveTasks();
    if (tasks.length === 0) {
      await ctx.reply('Aucune tache a passer.');
      return;
    }

    const next = await getNextTask();
    if (!next) return;

    const remaining = tasks.filter((t) => t.id !== next.id);
    if (remaining.length === 0) {
      await ctx.reply(`C'est ta seule tache. Courage ! /done quand c'est fait.`);
      return;
    }

    const nextAfterSkip = remaining[0]!;
    await ctx.reply(
      `⏭️ Tache passee : ${next.title}\n\n➡️ Prochaine tache :\n${formatTask(nextAfterSkip)}`
    );
  });
}
