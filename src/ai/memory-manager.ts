import { askClaude } from "./client.js";
import {
  getCoreMemory,
  getWorkingMemory,
  getMemoryByTier,
  upsertMemory,
  deleteMemory,
  type MemoryCategory,
  type MemoryEntry,
} from "../db/memory.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface MemoryChange {
  table: "memory";
  action: "create" | "update" | "delete";
  category: string;
  key: string;
  oldContent: string | null;
  newContent: string | null;
  reason: string;
}

export interface MemoryManagerResult {
  response: string;
  changes: MemoryChange[];
}

const MEMORY_MANAGER_PROMPT = `Ты — Агент Управления Памятью {ownerName} — ЕДИНСТВЕННЫЙ ответственный за все изменения базы данных памяти.

Ты управляешь ЛИЧНОЙ ПАМЯТЬЮ (таблица "memory")
Информация о {ownerName}.
Категории:
- identity = кто он, навыки, личность (меняется редко)
- situation = текущие дела, цели, финансы (меняется регулярно)
- preference = вкусы, методы, предпочитаемые инструменты
- relationship = инфо о конкретных людях (имя = ключ)
- lesson = опыт, ошибки, усвоенные уроки

=== ЛИЧНАЯ ПАМЯТЬ (${"{memory_count}"} записей) ===
{memory_state}

ИСТОРИЯ РАЗГОВОРА:
{history}

СТРОГИЕ ПРАВИЛА:
1. СУЩЕСТВУЮЩИЕ КЛЮЧИ: при update используй ТОЧНО существующий ключ в правильной категории. НИКОГДА не дублируй.
2. ТОЧЕЧНЫЕ ИЗМЕНЕНИЯ: при update меняй ТОЛЬКО затронутую часть содержимого. Остальной текст оставь НЕТРОНУТЫМ.
3. ПРОВЕРКА: покажи старое и новое содержимое в ответе, чтобы {ownerName} видел разницу.
4. Если НЕ УВЕРЕН, чего хочет {ownerName} → поставь "changes": [] и задай точный вопрос в "response".
5. Можешь выполнить НЕСКОЛЬКО изменений в одном ответе.
6. Если {ownerName} просто хочет ПОСМОТРЕТЬ память (без изменений) → поставь "changes": [] и покажи запрошенную инфо в "response".

ОТВЕТ (строгий JSON, БЕЗ markdown вокруг):
{
  "changes": [
    {
      "table": "memory",
      "action": "create" | "update" | "delete",
      "category": "...",
      "key": "точный_ключ",
      "old_content": "текущее содержимое (null если create)",
      "new_content": "новое ПОЛНОЕ содержимое записи (null если delete)",
      "reason": "почему это изменение"
    }
  ],
  "response": "Понятное сообщение для {ownerName}, подтверждающее изменения: старое → новое"
}`;

export async function processMemoryRequest(params: {
  userMessage: string;
  conversationHistory?: string;
}): Promise<MemoryManagerResult> {
  logger.info("Memory manager: processing request");

  const [coreMemory, workingMemory, archivalMemory] = await Promise.all([
    getCoreMemory(),
    getWorkingMemory(),
    getMemoryByTier("archival"),
  ]);

  const allMemory = [...coreMemory, ...workingMemory, ...archivalMemory];
  const memoryState = formatMemoryState(allMemory);

  const systemPrompt = MEMORY_MANAGER_PROMPT.replaceAll(
    "{ownerName}",
    config.ownerName,
  )
    .replace("{memory_count}", String(allMemory.length))
    .replace("{memory_state}", memoryState)
    .replace("{history}", params.conversationHistory || "(нет истории)");

  const response = await askClaude({
    prompt: params.userMessage,
    systemPrompt,
    model: "sonnet",
    maxTokens: 4096,
  });

  let jsonString = response.trim();
  if (jsonString.startsWith("```")) {
    jsonString = jsonString
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
  }

  interface ParsedChange {
    table: "memory";
    action: "create" | "update" | "delete";
    category: string;
    key: string;
    old_content: string | null;
    new_content: string | null;
    reason: string;
  }

  let parsed: { changes: ParsedChange[]; response: string };
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    logger.warn(
      { response: jsonString.substring(0, 200) },
      "Memory manager: failed to parse JSON",
    );
    return {
      response: response
        .replace(/```json\s*/g, "")
        .replace(/```/g, "")
        .trim(),
      changes: [],
    };
  }

  if (!parsed.changes || parsed.changes.length === 0) {
    return { response: parsed.response, changes: [] };
  }

  const executedChanges: MemoryChange[] = [];

  for (const change of parsed.changes) {
    try {
      const category = change.category as MemoryCategory;
      if (change.action === "delete") {
        await deleteMemory(category, change.key);
      } else {
        await upsertMemory({
          category,
          key: change.key,
          content: change.new_content ?? "",
          source: "memory_manager",
        });
      }

      executedChanges.push({
        table: "memory",
        action: change.action,
        category: change.category,
        key: change.key,
        oldContent: change.old_content ?? null,
        newContent: change.new_content ?? null,
        reason: change.reason ?? "",
      });

      logger.info(
        {
          table: change.table,
          action: change.action,
          category: change.category,
          key: change.key,
        },
        "Memory manager: change executed",
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { err: errMsg, change },
        "Memory manager: failed to execute change",
      );
    }
  }

  logger.info(
    { changeCount: executedChanges.length },
    "Memory manager: completed",
  );

  return {
    response: parsed.response,
    changes: executedChanges,
  };
}

function formatMemoryState(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "(пусто)";

  const tiers = {
    core: [] as MemoryEntry[],
    working: [] as MemoryEntry[],
    archival: [] as MemoryEntry[],
  };
  for (const entry of entries) {
    const tier = entry.tier ?? "working";
    if (tier in tiers) {
      tiers[tier as keyof typeof tiers].push(entry);
    }
  }

  let result = "";
  for (const [tier, tierEntries] of Object.entries(tiers)) {
    if (tierEntries.length === 0) continue;
    result += `--- TIER ${tier.toUpperCase()} ---\n`;
    const grouped: Record<string, MemoryEntry[]> = {};
    for (const entry of tierEntries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category]!.push(entry);
    }
    for (const [category, items] of Object.entries(grouped)) {
      result += `[${category}]\n`;
      for (const item of items) {
        result += `  • ${item.key}: ${item.content}\n`;
      }
    }
    result += "\n";
  }
  return result;
}
