import type { Task, DailyPlanTask, LivePlanTask } from "../types/index.js";

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: "🔴",
  important: "🟡",
  normal: "🟢",
  low: "⚪",
};

const CATEGORY_EMOJI: Record<string, string> = {
  client: "💼",
  student: "🎓",
  content: "📹",
  personal: "👤",
  dev: "💻",
  team: "👥",
};

export function formatTask(task: Task, index?: number): string {
  const priority = PRIORITY_EMOJI[task.priority] ?? "⚪";
  const category = CATEGORY_EMOJI[task.category] ?? "📌";
  const prefix = index !== undefined ? `${index}. ` : "";
  const time = task.estimated_minutes ? ` (${task.estimated_minutes} min)` : "";
  const due = task.due_date ? ` — deadline: ${task.due_date}` : "";

  return `${prefix}${priority}${category} ${task.title}${time}${due}`;
}

export function formatDailyPlan(planTasks: DailyPlanTask[]): string {
  const urgent = planTasks.filter((t) => t.time_slot === "urgent");
  const important = planTasks.filter((t) => t.time_slot === "important");
  const optional = planTasks.filter((t) => t.time_slot === "optional");

  let message = "";

  if (urgent.length > 0) {
    message += "🔴 СРОЧНОЕ (до 12ч):\n";
    urgent.forEach((t) => {
      const time = t.estimated_minutes ? ` (${t.estimated_minutes} min)` : "";
      message += `  ${t.order}. ${t.title}${time}\n`;
    });
    message += "\n";
  }

  if (important.length > 0) {
    message += "🟡 ВАЖНОЕ (до 17ч):\n";
    important.forEach((t) => {
      const time = t.estimated_minutes ? ` (${t.estimated_minutes} min)` : "";
      message += `  ${t.order}. ${t.title}${time}\n`;
    });
    message += "\n";
  }

  if (optional.length > 0) {
    message += "🟢 ЕСЛИ БУДЕТ ВРЕМЯ:\n";
    optional.forEach((t) => {
      const time = t.estimated_minutes ? ` (${t.estimated_minutes} min)` : "";
      message += `  ${t.order}. ${t.title}${time}\n`;
    });
    message += "\n";
  }

  return message;
}

const LIVE_STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  in_progress: "🔄",
  done: "✅",
  skipped: "⏭️",
  deferred: "📅",
};

export function formatLivePlanMessage(livePlan: LivePlanTask[]): string {
  const done = livePlan.filter((t) => t.status === "done");
  const pending = livePlan.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  const skippedOrDeferred = livePlan.filter(
    (t) => t.status === "skipped" || t.status === "deferred",
  );

  let message = `Прогресс: ${done.length}/${livePlan.length}\n\n`;

  if (pending.length > 0) {
    message += "СДЕЛАТЬ:\n";
    for (const t of pending) {
      const icon = LIVE_STATUS_ICON[t.status] ?? "⬜";
      const priority = PRIORITY_EMOJI[t.priority] ?? "⚪";
      const time = t.scheduled_time ? ` [${t.scheduled_time}]` : "";
      const est = t.estimated_minutes ? ` (${t.estimated_minutes} min)` : "";
      message += `  ${icon}${priority} ${t.order}. ${t.title}${time}${est}\n`;
    }
    message += "\n";
  }

  if (done.length > 0) {
    message += "СДЕЛАНО:\n";
    for (const t of done) {
      message += `  ✅ ${t.title}\n`;
    }
    message += "\n";
  }

  if (skippedOrDeferred.length > 0) {
    message += "ОТЛОЖЕНО/ПРОПУЩЕНО:\n";
    for (const t of skippedOrDeferred) {
      const icon = LIVE_STATUS_ICON[t.status] ?? "📅";
      const note = t.deferred_to ? ` → ${t.deferred_to}` : "";
      const reason = t.skip_reason ? ` (${t.skip_reason})` : "";
      message += `  ${icon} ${t.title}${note}${reason}\n`;
    }
    message += "\n";
  }

  return message;
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "Нет активных задач.";

  return tasks.map((task, i) => formatTask(task, i + 1)).join("\n");
}

export function todayDateString(): string {
  return new Date().toISOString().split("T")[0]!;
}

export function getDayOfWeek(): string {
  const days = [
    "Воскресенье",
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
  ];
  return days[new Date().getDay()]!;
}
