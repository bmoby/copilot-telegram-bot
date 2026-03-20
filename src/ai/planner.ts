import { askClaude } from "./client.js";
import type { Task, DailyPlanTask } from "../types/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const PLANNER_SYSTEM_PROMPT = `Ты — личный ассистент {ownerName}, копилот продуктивности.

КОНТЕКСТ:
- Продуктивное окно: 10ч-15ч (защищать любой ценой для глубокой работы)
- После 15ч: только лёгкие задачи (ответы, ревью, планирование)
- Он работает с конкретными целями и быстрыми победами
- Его мотивирует страх что-то потерять и видимый прогресс
- Его парализует, когда слишком много выбора → ты должен выбирать за него
- Ему нужно, чтобы за него решали, когда он колеблется

ПРАВИЛА ПРИОРИТИЗАЦИИ:
1. СРОЧНОЕ + близкий дедлайн = в первую очередь (слот "urgent", макс 2-3)
2. Задачи, которые разблокируют других (команда, клиенты, студенты) = приоритетные
3. Максимум 3 задачи "urgent" в день (иначе паралич)
4. ВСЕГДА начинать с быстрой задачи (<15 мин) для разгона
5. После 15ч: только лёгкие задачи
6. Если спорт не делался 3+ дня — включить тренировку
7. Всего: 5-7 задач макс в день (не больше)

ФОРМАТ ОТВЕТА:
Отвечай ТОЛЬКО валидным JSON, без markdown, без комментариев.
JSON должен быть массивом объектов с полями:
- task_id: string (id задачи)
- title: string
- category: string
- priority: string
- estimated_minutes: number или null
- time_slot: "urgent" | "important" | "optional"
- order: number (1 = первая задача)`;

export async function generateDailyPlan(params: {
  activeTasks: Task[];
  overdueTasks: Task[];
  dayOfWeek: string;
  sportDoneRecently: boolean;
}): Promise<DailyPlanTask[]> {
  const { activeTasks, overdueTasks, dayOfWeek, sportDoneRecently } = params;

  if (activeTasks.length === 0 && overdueTasks.length === 0) {
    logger.info("No tasks to plan");
    return [];
  }

  const allTasks = [...overdueTasks, ...activeTasks];
  const tasksSummary = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    priority: t.priority,
    status: t.status,
    due_date: t.due_date,
    estimated_minutes: t.estimated_minutes,
    notes: t.notes,
  }));

  const prompt = `Сегодня ${dayOfWeek}.
Спорт недавно: ${sportDoneRecently ? "Да" : "Нет (3+ дней без спорта)"}

Вот все активные и просроченные задачи:
${JSON.stringify(tasksSummary, null, 2)}

Сгенерируй план дня. Напоминание: макс 5-7 задач, начни с быстрой.`;

  const systemPrompt = PLANNER_SYSTEM_PROMPT.replaceAll(
    "{ownerName}",
    config.ownerName,
  );

  const response = await askClaude({
    prompt,
    systemPrompt,
    model: "sonnet",
  });

  try {
    const parsed = JSON.parse(response) as DailyPlanTask[];
    logger.info({ taskCount: parsed.length }, "Daily plan generated");
    return parsed;
  } catch {
    logger.error({ response }, "Failed to parse daily plan from Claude");
    return allTasks.slice(0, 5).map((t, i) => ({
      task_id: t.id,
      title: t.title,
      category: t.category,
      priority: t.priority,
      estimated_minutes: t.estimated_minutes,
      time_slot:
        i < 2
          ? ("urgent" as const)
          : i < 4
            ? ("important" as const)
            : ("optional" as const),
      order: i + 1,
    }));
  }
}
