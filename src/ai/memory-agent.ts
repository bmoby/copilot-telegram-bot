import { askClaude } from "./client.js";
import {
  getCoreMemory,
  getWorkingMemory,
  upsertMemory,
  deleteMemory,
  type MemoryEntry,
} from "../db/memory.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const MEMORY_AGENT_PROMPT = `Ты — Агент Памяти. Ты анализируешь сообщения {ownerName} и определяешь, нужно ли обновить долговременную память.

ТЕКУЩАЯ ПАМЯТЬ:
{memory}

СООБЩЕНИЕ {ownerName}:
{message}

ДЕЙСТВИЯ, УЖЕ ВЫПОЛНЕННЫЕ СИСТЕМОЙ:
{actions}

ПРАВИЛА:
- Обновляй только когда это ЗНАЧИМО (не по пустякам)
- Возможные категории: identity, situation, preference, relationship, lesson
- "identity" = личность, навыки, особенности (меняется редко) → TIER CORE (постоянный)
- "situation" = текущие дела, команда, цели, финансы → TIER WORKING (истекает через 30д)
- "preference" = вкусы, предпочитаемые методы → TIER WORKING (истекает через 30д)
- "relationship" = инфо о конкретном человеке (имя = ключ) → TIER WORKING (истекает через 30д)
- "lesson" = опыт, прошлая ошибка, усвоенный урок → TIER ARCHIVAL (постоянный, семантический поиск)
- Для relationships используй имя человека как "key"
- Если существующая информация устарела — обнови её
- Если информация полностью неверна — удали её

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "updates": [
    {
      "action": "create" | "update" | "delete",
      "category": "identity|situation|preference|relationship|lesson",
      "key": "короткий_идентификатор",
      "content": "содержимое для хранения",
      "reason": "почему это обновление"
    }
  ]
}

Если НИЧЕГО не нужно обновлять, отвечай: { "updates": [] }`;

export async function runMemoryAgent(params: {
  message: string;
  actionsSummary: string;
}): Promise<void> {
  try {
    const [coreMemory, workingMemory] = await Promise.all([
      getCoreMemory(),
      getWorkingMemory(),
    ]);
    const allMemory = [...coreMemory, ...workingMemory];
    const memoryFormatted = formatMemoryForPrompt(allMemory);

    const prompt = MEMORY_AGENT_PROMPT.replaceAll(
      "{ownerName}",
      config.ownerName,
    )
      .replace("{memory}", memoryFormatted)
      .replace("{message}", params.message)
      .replace("{actions}", params.actionsSummary);

    const response = await askClaude({
      prompt: "Проанализируй это сообщение и обнови память при необходимости.",
      systemPrompt: prompt,
      model: "sonnet",
      maxTokens: 1024,
    });

    let jsonString = response.trim();
    if (jsonString.startsWith("```")) {
      jsonString = jsonString
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonString) as {
      updates: Array<{
        action: "create" | "update" | "delete";
        category: string;
        key: string;
        content?: string;
        reason?: string;
      }>;
    };

    if (parsed.updates.length === 0) {
      logger.debug("Memory agent: no updates needed");
      return;
    }

    for (const update of parsed.updates) {
      try {
        if (update.action === "delete") {
          await deleteMemory(
            update.category as
              | "identity"
              | "situation"
              | "preference"
              | "relationship"
              | "lesson",
            update.key,
          );
          logger.info(
            {
              category: update.category,
              key: update.key,
              reason: update.reason,
            },
            "Memory deleted by agent",
          );
        } else {
          await upsertMemory({
            category: update.category as
              | "identity"
              | "situation"
              | "preference"
              | "relationship"
              | "lesson",
            key: update.key,
            content: update.content ?? "",
            source: "memory_agent",
          });
          logger.info(
            {
              action: update.action,
              category: update.category,
              key: update.key,
              reason: update.reason,
            },
            "Memory updated by agent",
          );
        }
      } catch (error) {
        logger.error({ error, update }, "Failed to execute memory update");
      }
    }

    logger.info({ count: parsed.updates.length }, "Memory agent completed");
  } catch (error) {
    logger.error({ error }, "Memory agent failed");
  }
}

function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  const grouped: Record<string, MemoryEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.category]) {
      grouped[entry.category] = [];
    }
    grouped[entry.category]!.push(entry);
  }

  let result = "";
  for (const [category, items] of Object.entries(grouped)) {
    result += `\n[${category.toUpperCase()}]\n`;
    for (const item of items) {
      result += `- ${item.key}: ${item.content}\n`;
    }
  }
  return result || "(пусто)";
}
