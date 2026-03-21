import { askClaude } from "./client.js";
import { buildContext } from "./context-builder.js";
import { logger } from "../logger.js";

export interface ResearchResult {
  content: string;
}

const RESEARCH_PROMPT = `Ты — экспертный исследовательский агент, без ограничений в глубине анализа.

ТЕМА:
{topic}

ДЕТАЛИ:
{details}

{memory_context}

ТВОЯ МИССИЯ:
Создай ПОЛНЫЙ и ГЛУБОКИЙ исследовательский отчёт. Не сдерживайся. Копай до сути.

- Исследуй ВСЕ возможные ракурсы темы
- Приводи конкретные данные, цифры, актуальную статистику
- Анализируй текущие тренды, развитие, перспективы
- Упоминай ключевых игроков, компании, конкретные кейсы
- Сравнивай различные подходы, методологии, решения
- Выявляй риски, возможности, точки внимания
- Давай практические и аргументированные рекомендации
- Не стесняйся углубляться в каждую подтему
- Используй все свои знания, включая самые свежие

ФОРМАТ:
- Пиши на русском языке
- Используй чёткие заголовки с эмодзи для читаемости
- Развёрнутые абзацы, не шаблонные буллет-поинты
- Каждая секция должна быть содержательной (не просто 2 строки)
- Заверши конкретными рекомендациями и источниками
- Пиши столько, сколько нужно, НЕ ограничивай себя по объёму

ВАЖНО: Отвечай прямо структурированным текстом. БЕЗ JSON. БЕЗ кода. Только отчёт.`;

export async function runResearchAgent(params: {
  topic: string;
  details: string;
  includeMemory?: boolean;
}): Promise<ResearchResult> {
  logger.info({ topic: params.topic }, "Starting research agent");

  let memoryContext = "";
  if (params.includeMemory) {
    try {
      const context = await buildContext();
      memoryContext = `ЛИЧНЫЙ КОНТЕКСТ (используй, если релевантно для обогащения исследования):\n${context}`;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        "Failed to build context for research",
      );
    }
  }

  const prompt = RESEARCH_PROMPT.replace("{topic}", params.topic)
    .replace(
      "{details}",
      params.details || "Нет дополнительных деталей. Исследуй тему свободно.",
    )
    .replace("{memory_context}", memoryContext);

  const response = await askClaude({
    prompt: `Проведи глубокое и полное исследование по этой теме. Не ограничивай себя. Давай на полную.`,
    systemPrompt: prompt,
    model: "sonnet",
    maxTokens: 16000,
  });

  logger.info(
    { topic: params.topic, responseLength: response.length },
    "Research agent completed",
  );

  return { content: response };
}
