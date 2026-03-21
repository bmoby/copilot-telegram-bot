import {
  getCoreMemory,
  getWorkingMemory,
  computeDecay,
  type MemoryEntry,
} from "../db/memory.js";
import { getActiveTasks } from "../db/tasks.js";
import { getClientPipeline } from "../db/clients.js";
import { getTodayLivePlan } from "../db/daily-plans.js";
import type { LivePlanTask } from "../types/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface BuildContextOptions {
  maxTasks?: number;
  userMessage?: string;
}

export async function buildContext(
  options?: BuildContextOptions,
): Promise<string> {
  try {
    const maxTasks = options?.maxTasks ?? 15;

    const [coreMemory, workingMemory] = await Promise.all([
      getCoreMemory(),
      getWorkingMemory(),
    ]);

    const [activeTasks, clients, livePlan] = await Promise.all([
      getActiveTasks(),
      getClientPipeline(),
      getTodayLivePlan(),
    ]);

    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const timeStr = now.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });

    let context = "";

    // Core memory (identity — always present, no decay)
    if (coreMemory.length > 0) {
      context += `КТО ТАКОЙ ${config.ownerName.toUpperCase()}:\n`;
      context += formatEntries(coreMemory);
      context += "\n";
    }

    // Working memory — sorted by freshness (temporal decay)
    if (workingMemory.length > 0) {
      const withDecay = workingMemory.map((m) => ({
        entry: m,
        decay: computeDecay(m.last_confirmed),
      }));
      withDecay.sort((a, b) => b.decay - a.decay);

      const fresh = withDecay.filter((d) => d.decay > 0.5);
      const fading = withDecay.filter((d) => d.decay <= 0.5);

      const freshByCategory = groupByCategory(fresh.map((d) => d.entry));

      if (freshByCategory.situation.length > 0) {
        context += "ТЕКУЩАЯ СИТУАЦИЯ:\n";
        context += formatEntries(freshByCategory.situation);
        context += "\n";
      }

      if (freshByCategory.preference.length > 0) {
        context += "ПРЕДПОЧТЕНИЯ И СПОСОБ РАБОТЫ:\n";
        context += formatEntries(freshByCategory.preference);
        context += "\n";
      }

      if (freshByCategory.relationship.length > 0) {
        context += "ЗНАКОМЫЕ ЛЮДИ:\n";
        context += formatEntries(freshByCategory.relationship);
        context += "\n";
      }

      if (fading.length > 0) {
        const fadingKeys = fading.map((d) => d.entry.key).join(", ");
        context += `СТАРАЯ ПАМЯТЬ (${fading.length}, подтверждена >30д назад): ${fadingKeys}\n\n`;
      }
    }

    // Live plan for today
    if (livePlan && livePlan.length > 0) {
      context += formatLivePlan(livePlan);
    }

    // Live tasks
    context += `АКТИВНЫЕ ЗАДАЧИ (${activeTasks.length}):\n`;
    if (activeTasks.length === 0) {
      context += "- Нет задач\n";
    } else {
      for (const t of activeTasks.slice(0, maxTasks)) {
        const due = t.due_date ? ` (deadline: ${t.due_date})` : "";
        context += `- [${t.priority}] ${t.title} (${t.category})${due}\n`;
      }
      if (activeTasks.length > maxTasks) {
        context += `  ... и ещё ${activeTasks.length - maxTasks}\n`;
      }
    }
    context += "\n";

    // Live clients
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const terminalStatuses = new Set(["delivered", "paid"]);
    const activeClients = clients.filter((c) => {
      if (!terminalStatuses.has(c.status)) return true;
      return new Date(c.updated_at) > sevenDaysAgo;
    });

    context += `КЛИЕНТЫ (${activeClients.length}):\n`;
    if (activeClients.length === 0) {
      context += "- Нет клиентов в воронке\n";
    } else {
      for (const c of activeClients) {
        context += `- ${c.name} [${c.status}]${c.need ? ` - ${c.need}` : ""}${c.budget_range ? ` (${c.budget_range})` : ""}\n`;
      }
    }
    context += "\n";

    // Temporal
    context += `ДАТА И ВРЕМЯ: ${dateStr}, ${timeStr}\n`;

    return context;
  } catch (error) {
    logger.error({ error }, "Failed to build context");
    return "Ошибка при построении контекста. Данные недоступны.";
  }
}

const LIVE_STATUS_LABEL: Record<string, string> = {
  pending: "СДЕЛАТЬ",
  in_progress: "В ПРОЦЕССЕ",
  done: "СДЕЛАНО",
  skipped: "ПРОПУЩЕНО",
  deferred: "ОТЛОЖЕНО",
};

function formatLivePlan(plan: LivePlanTask[]): string {
  const pending = plan.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  const done = plan.filter((t) => t.status === "done");
  const skippedOrDeferred = plan.filter(
    (t) => t.status === "skipped" || t.status === "deferred",
  );

  let text = `ПЛАН ДНЯ (${done.length}/${plan.length} сделано):\n`;

  for (const t of plan) {
    const statusLabel = LIVE_STATUS_LABEL[t.status] ?? t.status;
    const time = t.scheduled_time ? ` [${t.scheduled_time}]` : "";
    const est = t.estimated_minutes ? ` (${t.estimated_minutes} min)` : "";
    const deferNote = t.deferred_to ? ` → перенесено на ${t.deferred_to}` : "";
    const skipNote = t.skip_reason ? ` (${t.skip_reason})` : "";
    text += `  ${t.order}. [${statusLabel}] ${t.title}${time}${est}${deferNote}${skipNote}\n`;
  }

  if (pending.length > 0) {
    text += `Следующая задача: ${pending[0]!.title}\n`;
  }
  text += "\n";
  return text;
}

function formatEntries(entries: MemoryEntry[]): string {
  return entries.map((e) => `- ${e.key}: ${e.content}`).join("\n") + "\n";
}

interface GroupedEntries {
  situation: MemoryEntry[];
  preference: MemoryEntry[];
  relationship: MemoryEntry[];
}

function groupByCategory(entries: MemoryEntry[]): GroupedEntries {
  const result: GroupedEntries = {
    situation: [],
    preference: [],
    relationship: [],
  };
  for (const entry of entries) {
    if (entry.category in result) {
      result[entry.category as keyof GroupedEntries].push(entry);
    }
  }
  return result;
}
