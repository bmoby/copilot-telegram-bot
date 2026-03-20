import type { Bot, Context } from "grammy";
import {
  getNextTask,
  getActiveTasks,
  completeTask,
  createTask,
} from "../db/tasks.js";
import type { Task } from "../types/index.js";
import { formatTask, formatTaskList } from "../utils/format.js";
import { isAdmin } from "../utils/auth.js";

export function registerTaskCommands(bot: Bot): void {
  bot.command("next", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const task = await getNextTask();
    if (!task) {
      await ctx.reply("Нет задач в очереди. Наслаждайся моментом спокойствия!");
      return;
    }

    const time = task.estimated_minutes
      ? `\nОценка времени: ${task.estimated_minutes} мин`
      : "";
    await ctx.reply(
      `➡️ Следующая задача:\n\n${formatTask(task)}${time}\n\nТолько эта. Ничего больше.\n\n/done когда сделаешь.`,
    );
  });

  bot.command("tasks", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const tasks = await getActiveTasks();
    await ctx.reply(
      `📋 Активные задачи (${tasks.length}):\n\n${formatTaskList(tasks)}`,
    );
  });

  bot.command("done", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const arg = ctx.match?.toString().trim();

    let completedTask: Task;

    if (arg) {
      const index = parseInt(arg, 10);
      if (isNaN(index)) {
        await ctx.reply(
          "Использование: /done [номер] или /done (для текущей задачи)",
        );
        return;
      }
      const tasks = await getActiveTasks();
      const task = tasks[index - 1];
      if (!task) {
        await ctx.reply(`Задача #${index} не найдена.`);
        return;
      }
      completedTask = await completeTask(task.id);
    } else {
      const task = await getNextTask();
      if (!task) {
        await ctx.reply("Нет задач для завершения.");
        return;
      }
      completedTask = await completeTask(task.id);
    }

    const next = await getNextTask();
    let message = `✅ Сделано: ${completedTask.title}\n\nМолодец!`;

    if (next) {
      message += `\n\n➡️ Следующая задача:\n${formatTask(next)}`;
    } else {
      message += "\n\n🎉 Задач больше нет! Ты всё сделал.";
    }

    await ctx.reply(message);
  });

  bot.command("add", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const text = ctx.match?.toString().trim();
    if (!text) {
      await ctx.reply("Использование: /add [описание задачи]");
      return;
    }

    const task = await createTask({
      title: text,
      source: "telegram",
      category: "personal",
      priority: "normal",
      status: "todo",
    });

    await ctx.reply(
      `✅ Задача добавлена: ${task.title}\n\nКатегория: ${task.category}\nПриоритет: ${task.priority}`,
    );
  });

  bot.command("skip", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const tasks = await getActiveTasks();
    if (tasks.length === 0) {
      await ctx.reply("Нет задач для пропуска.");
      return;
    }

    const next = await getNextTask();
    if (!next) return;

    const remaining = tasks.filter((t) => t.id !== next.id);
    if (remaining.length === 0) {
      await ctx.reply(
        `Это твоя единственная задача. Давай! /done когда сделаешь.`,
      );
      return;
    }

    const nextAfterSkip = remaining[0]!;
    await ctx.reply(
      `⏭️ Задача пропущена: ${next.title}\n\n➡️ Следующая задача:\n${formatTask(nextAfterSkip)}`,
    );
  });
}
