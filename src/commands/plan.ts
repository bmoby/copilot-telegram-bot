import type { Bot, Context } from "grammy";
import { getActiveTasks } from "../db/tasks.js";
import { getOverdueTasks } from "../db/tasks.js";
import {
  getDailyPlan,
  saveDailyPlan,
  initLivePlanFromStatic,
} from "../db/daily-plans.js";
import { generateDailyPlan } from "../ai/planner.js";
import {
  formatDailyPlan,
  formatLivePlanMessage,
  todayDateString,
  getDayOfWeek,
} from "../utils/format.js";
import { isAdmin } from "../utils/auth.js";

export function registerPlanCommand(bot: Bot): void {
  bot.command("plan", async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const today = todayDateString();

    let plan = await getDailyPlan(today);

    if (!plan) {
      await ctx.reply("Генерирую план...");

      const activeTasks = await getActiveTasks();
      const overdueTasks = await getOverdueTasks();

      const planTasks = await generateDailyPlan({
        activeTasks,
        overdueTasks,
        dayOfWeek: getDayOfWeek(),
        sportDoneRecently: false,
      });

      const livePlan = initLivePlanFromStatic(planTasks);

      plan = await saveDailyPlan({
        date: today,
        plan: planTasks,
        live_plan: livePlan,
        status: "active",
        review: null,
        productivity_score: null,
        revision_count: 0,
        last_reorganized_at: null,
      });
    }

    const dayName = getDayOfWeek();
    const dateFormatted = new Date().toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });

    let message = `План на ${dayName} ${dateFormatted}\n\n`;

    // Show live plan if available, otherwise static plan
    if (plan.live_plan && plan.live_plan.length > 0) {
      message += formatLivePlanMessage(plan.live_plan);
      if (plan.revision_count > 0) {
        message += `\nРеорганизован ${plan.revision_count} раз(а) сегодня.\n`;
      }
    } else {
      message += formatDailyPlan(plan.plan);
    }

    message += "\nЗолотое окно: 10ч-15ч. Защищай его.\n\n";
    message += "Если сделаешь хотя бы красные — уже хорошо.";

    await ctx.reply(message);
  });
}
