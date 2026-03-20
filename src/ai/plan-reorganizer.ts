import { askClaude } from "./client.js";
import { buildContext } from "./context-builder.js";
import {
  getDailyPlan,
  updateLivePlan,
  initLivePlanFromStatic,
} from "../db/daily-plans.js";
import { getActiveTasks, getOverdueTasks } from "../db/tasks.js";
import { generateDailyPlan } from "./planner.js";
import type { LivePlanTask } from "../types/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { todayDateString, getDayOfWeek } from "../utils/format.js";

const REORGANIZER_PROMPT = `Ты — реорганизатор дня {ownerName}.

{context}

СИТУАЦИЯ: Произошло непредвиденное или изменение. Тебе нужно РЕОРГАНИЗОВАТЬ остаток дня.

ТЕКУЩИЙ ПЛАН ДНЯ:
{livePlan}

СОБЫТИЕ-ТРИГГЕР:
{trigger}

ТЕКУЩЕЕ ВРЕМЯ: {currentTime}

ПРАВИЛА РЕОРГАНИЗАЦИИ:
1. Задачи "done" НЕ меняются
2. Задачи "in_progress" остаются, если явно не отменены
3. Переупорядочь задачи "pending" по новой реальности
4. Если у пользователя нет энергии → лёгкие задачи вперёд, тяжёлые отложить
5. Если непредвиденное занимает время → сдвинь или отложи несрочные задачи
6. Если пользователь хочет заняться другим → напомни о срочном, НО адаптируйся, если настаивает
7. Максимум 2-3 переноса в день (иначе это прокрастинация, скажи об этом мягко)
8. Срочные задачи с дедлайном сегодня НЕ МОГУТ быть перенесены (кроме форс-мажора)
9. При переносе ставь дату завтра (или следующий рабочий день)
10. Пересчитай порядок с учётом оставшегося времени в дне

ФОРМАТ ОТВЕТА (строгий JSON):
{
  "reorganized_plan": [
    {
      "task_id": "string",
      "title": "string",
      "category": "string",
      "priority": "string",
      "estimated_minutes": number | null,
      "time_slot": "urgent" | "important" | "optional",
      "order": number,
      "status": "pending" | "in_progress" | "done" | "skipped" | "deferred",
      "scheduled_time": "HH:MM" | null,
      "completed_at": "ISO" | null,
      "deferred_to": "YYYY-MM-DD" | null,
      "skip_reason": "string" | null
    }
  ],
  "explanation": "Краткое объяснение (2-3 строки), что изменилось и почему",
  "warnings": ["string"]
}

ВАЖНО для "warnings":
- Если срочные задачи перенесены — добавь предупреждение
- Если пользователь переносит слишком много (3+) — мягко предупреди
- Если план стал нереалистичным (слишком много задач на оставшееся время) — скажи об этом`;

export interface ReorganizeResult {
  livePlan: LivePlanTask[];
  explanation: string;
  warnings: string[];
}

export async function reorganizePlan(
  trigger: string,
): Promise<ReorganizeResult> {
  const today = todayDateString();
  let plan = await getDailyPlan(today);

  // If no plan exists yet, generate one first
  if (!plan) {
    const activeTasks = await getActiveTasks();
    const overdueTasks = await getOverdueTasks();
    const planTasks = await generateDailyPlan({
      activeTasks,
      overdueTasks,
      dayOfWeek: getDayOfWeek(),
      sportDoneRecently: false,
    });

    const { saveDailyPlan } = await import("../db/daily-plans.js");
    plan = await saveDailyPlan({
      date: today,
      plan: planTasks,
      live_plan: initLivePlanFromStatic(planTasks),
      status: "active",
      review: null,
      productivity_score: null,
      revision_count: 0,
      last_reorganized_at: null,
    });
  }

  // Ensure live_plan exists
  if (!plan.live_plan) {
    plan.live_plan = initLivePlanFromStatic(plan.plan);
    await updateLivePlan(today, plan.live_plan);
  }

  const context = await buildContext();
  const now = new Date();
  const currentTime = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const livePlanStr = plan.live_plan
    .map(
      (t) =>
        `  ${t.order}. [${t.status}] ${t.title} (${t.priority}, ${t.estimated_minutes ?? "?"} min)${t.scheduled_time ? ` @${t.scheduled_time}` : ""}${t.deferred_to ? ` → перенесено ${t.deferred_to}` : ""}`,
    )
    .join("\n");

  const systemPrompt = REORGANIZER_PROMPT.replaceAll(
    "{ownerName}",
    config.ownerName,
  )
    .replace("{context}", context)
    .replace("{livePlan}", livePlanStr)
    .replace("{trigger}", trigger)
    .replace("{currentTime}", currentTime);

  const response = await askClaude({
    prompt: `Реорганизуй план дня в связи с этим событием: ${trigger}`,
    systemPrompt,
    model: "sonnet",
  });

  let jsonString = response.trim();
  if (jsonString.startsWith("```")) {
    jsonString = jsonString
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonString) as {
      reorganized_plan: LivePlanTask[];
      explanation: string;
      warnings: string[];
    };

    const newPlan = parsed.reorganized_plan;
    await updateLivePlan(today, newPlan, true);

    logger.info(
      { taskCount: newPlan.length, revision: (plan.revision_count ?? 0) + 1 },
      "Plan reorganized",
    );

    return {
      livePlan: newPlan,
      explanation: parsed.explanation,
      warnings: parsed.warnings ?? [],
    };
  } catch {
    logger.error(
      { response: jsonString.slice(0, 500) },
      "Failed to parse reorganization response",
    );
    return {
      livePlan: plan.live_plan,
      explanation: "Ошибка при реорганизации. План остаётся без изменений.",
      warnings: [],
    };
  }
}

/**
 * Sync live plan when a task is completed via the orchestrator.
 * Marks the task as done in the live plan automatically.
 */
export async function syncTaskCompletion(taskId: string): Promise<void> {
  const today = todayDateString();
  const plan = await getDailyPlan(today);
  if (!plan?.live_plan) return;

  const taskInPlan = plan.live_plan.find((t) => t.task_id === taskId);
  if (!taskInPlan || taskInPlan.status === "done") return;

  const updated = plan.live_plan.map((t) => {
    if (t.task_id !== taskId) return t;
    return {
      ...t,
      status: "done" as const,
      completed_at: new Date().toISOString(),
    };
  });

  await updateLivePlan(today, updated);
  logger.info({ taskId }, "Live plan synced after task completion");
}
