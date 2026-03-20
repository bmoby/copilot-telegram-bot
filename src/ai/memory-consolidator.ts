import { askClaude } from "./client.js";
import {
  getExpiredMemory,
  moveToTier,
  deleteMemory,
  upsertMemory,
  type MemoryEntry,
  type MemoryCategory,
} from "../db/memory.js";
import { logger } from "../logger.js";

const CONSOLIDATION_PROMPT = `Ты — Агент Консолидации Памяти. Ты пересматриваешь истёкшие рабочие воспоминания и решаешь, что с ними делать.

ИСТЁКШИЕ ВОСПОМИНАНИЯ ДЛЯ ПЕРЕСМОТРА:
{memories}

Для каждого воспоминания реши:
- "archive" → инфо по-прежнему полезна, но не ежедневно (усвоенные уроки, старые ситуации). Будет доступна через поиск.
- "delete" → инфо полностью устарела или дублируется
- "renew" → инфо ещё актуальна и должна остаться в рабочей памяти (ещё 30 дней)

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "decisions": [
    {
      "category": "...",
      "key": "...",
      "action": "archive" | "delete" | "renew",
      "reason": "почему такое решение"
    }
  ]
}`;

export interface ConsolidationResult {
  archived: number;
  deleted: number;
  renewed: number;
  total: number;
}

export async function runMemoryConsolidation(): Promise<ConsolidationResult> {
  const result: ConsolidationResult = {
    archived: 0,
    deleted: 0,
    renewed: 0,
    total: 0,
  };

  try {
    const expiredMemories = await getExpiredMemory();

    if (expiredMemories.length === 0) {
      logger.debug("Memory consolidation: no expired memories to process");
      return result;
    }

    result.total = expiredMemories.length;
    logger.info(
      { count: expiredMemories.length },
      "Memory consolidation: reviewing expired memories",
    );

    const memoriesFormatted = expiredMemories
      .map(
        (m) =>
          `[${m.category}] ${m.key}: ${m.content} (expired: ${m.expires_at})`,
      )
      .join("\n");

    const prompt = CONSOLIDATION_PROMPT.replace(
      "{memories}",
      memoriesFormatted,
    );

    const response = await askClaude({
      prompt: "Пересмотри эти истёкшие воспоминания и реши, что с ними делать.",
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
      decisions: Array<{
        category: string;
        key: string;
        action: "archive" | "delete" | "renew";
        reason: string;
      }>;
    };

    for (const decision of parsed.decisions) {
      try {
        const category = decision.category as MemoryCategory;

        switch (decision.action) {
          case "archive":
            await moveToTier(category, decision.key, "archival");
            result.archived++;
            break;
          case "delete":
            await deleteMemory(category, decision.key);
            result.deleted++;
            break;
          case "renew": {
            const original = expiredMemories.find(
              (m) => m.category === category && m.key === decision.key,
            );
            if (original) {
              await upsertMemory({
                category,
                key: decision.key,
                content: original.content,
                source: original.source,
                tier: "working",
              });
            }
            result.renewed++;
            break;
          }
        }

        logger.info(
          {
            action: decision.action,
            category,
            key: decision.key,
            reason: decision.reason,
          },
          "Memory consolidation: decision executed",
        );
      } catch (error) {
        logger.error(
          { error, decision },
          "Memory consolidation: failed to execute decision",
        );
      }
    }

    logger.info(result, "Memory consolidation completed");
  } catch (error) {
    logger.error({ error }, "Memory consolidation failed");
  }

  return result;
}
