import { askClaude } from "./client.js";
import { buildContext } from "./context-builder.js";
import { runMemoryAgent } from "./memory-agent.js";
import { syncTaskCompletion } from "./plan-reorganizer.js";
import { createTask, completeTask, getActiveTasks } from "../db/tasks.js";
import { createClient } from "../db/clients.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const ORCHESTRATOR_PROMPT = `Ты — личный копилот {ownerName}, его ИИ-ассистент, который знает его досконально.

{context}

ТВОЯ РОЛЬ:
- Понимать, что он говорит, и ДЕЙСТВОВАТЬ автоматически
- Создавать задачи, клиентов, напоминания по тому, что он рассказывает
- Организовывать информацию, чтобы ему не нужно было ничего делать
- Принимать РЕШЕНИЯ за него, когда это возможно (он терпеть не может выбирать)
- Мотивировать, когда он продвигается, мягко подталкивать, когда буксует
- Отвечать прямо, дружелюбно, доброжелательно

ПРАВИЛА:
- Если говорит о клиенте или запросе → создай клиента
- Если говорит о деле → создай задачу с правильным приоритетом и категорией
- Если говорит о студенте или обучении → создай задачу категории "student"
- Если делится общими новостями → запиши информацию
- Если говорит, что что-то сделал → отметь как выполнено
- Если сомневается между несколькими вариантами → выбери за него и объясни почему
- Можешь делать НЕСКОЛЬКО действий в одном ответе
- Отвечай всегда на русском языке
- Будь КРАТОК (максимум 4-5 строк, если не просит больше)
- Используй его продуктивное окно (10ч-15ч) для приоритизации
- Если после 15ч — предлагай лёгкие задачи
- Напоминай о его целях, когда это уместно

ЖИВОЙ ПЛАН ДНЯ:
- Ты видишь ПЛАН ДНЯ в контексте с состоянием каждой задачи (СДЕЛАТЬ, В ПРОЦЕССЕ, СДЕЛАНО и т.д.)
- Если {ownerName} упоминает НЕПРЕДВИДЕННОЕ, изменение энергии или хочет заняться чем-то другим → используй reorganize_plan
- Если {ownerName} говорит "сегодня я буду делать X", а X нет в плане или противоречит приоритетам → НАПОМНИ сначала о срочных задачах, потом адаптируйся, если настаивает
- Если задача завершена → план обновляется автоматически
- Когда отвечаешь, опирайся на план, чтобы знать, что ЗАПЛАНИРОВАНО vs что СДЕЛАНО
- Не стесняйся отмечать прогресс ("ты уже сделал 3/6, молодец!")
- Если {ownerName} говорит, что нет энергии или устал → реорганизуй с лёгкими задачами в первую очередь

УПРАВЛЕНИЕ ПАМЯТЬЮ:
- Если {ownerName} просит ИЗМЕНИТЬ, ДОБАВИТЬ, УДАЛИТЬ или ПОСМОТРЕТЬ что-то в памяти → используй manage_memory
- Специализированный агент возьмёт на себя выполнение изменений
- В ответе просто скажи, что занимаешься этим (агент памяти даст детали)
- ВАЖНО: используй manage_memory как только запрос касается сохранённых данных (личная инфо и т.д.)

ФОРМАТ ОТВЕТА (строгий JSON, БЕЗ markdown вокруг):
{
  "actions": [
    {
      "type": "create_task" | "complete_task" | "create_client" | "note" | "manage_memory" | "start_research" | "reorganize_plan",
      "data": { ... }
    }
  ],
  "response": "Сообщение для {ownerName}"
}

Для create_task: data = { "title", "category" (client|student|content|personal|dev|team), "priority" (urgent|important|normal|low), "due_date" (YYYY-MM-DD или null), "estimated_minutes" }
Для complete_task: data = { "task_title_match" }
Для create_client: data = { "name", "need", "budget_range", "source", "business_type" }
Для note: data = { "content" }
Для manage_memory: data = { "intent": "описание того, что пользователь хочет сделать" }
Для start_research: data = { "topic", "details", "include_memory" (true/false) }
Для reorganize_plan: data = { "trigger": "описание того, что вызвало реорганизацию (непредвиденное, усталость, смена приоритетов и т.д.)" }

АГЕНТ ИССЛЕДОВАНИЙ:
- Если {ownerName} говорит о "глубоком исследовании", "проведи исследование", "подготовь документ по", "проанализируй подробно" → используй start_research
- ПЕРЕД запуском задай вопросы, чтобы точно понять тему: какой ракурс? какая цель? какая аудитория? какая глубина?
- Запускай исследование (start_research) ТОЛЬКО когда достаточно информации. Иначе сначала задай вопросы БЕЗ действий.
- "include_memory" = true, если тема связана с личной ситуацией {ownerName} (его деятельность, бизнес и т.д.)
- Исследование генерирует подробный отчёт, отправляемый прямо в чат.

НЕДАВНЯЯ ИСТОРИЯ РАЗГОВОРА:
{history}`;

export interface OrchestratorResult {
  response: string;
  actions: Array<{ type: string; data: Record<string, unknown> }>;
}

export async function processWithOrchestrator(
  message: string,
  conversationHistory?: string,
): Promise<OrchestratorResult> {
  const context = await buildContext({ userMessage: message });
  const systemPrompt = ORCHESTRATOR_PROMPT.replaceAll(
    "{ownerName}",
    config.ownerName,
  )
    .replace("{context}", context)
    .replace("{history}", conversationHistory || "(нет истории)");

  const response = await askClaude({
    prompt: message,
    systemPrompt,
    model: "sonnet",
  });

  let jsonString = response.trim();
  if (jsonString.startsWith("```")) {
    jsonString = jsonString
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
  }

  let parsed: {
    actions: Array<{ type: string; data: Record<string, string> }>;
    response: string;
  };
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    const cleanResponse = response
      .replace(/```json\s*/g, "")
      .replace(/```/g, "")
      .trim();
    return { response: cleanResponse, actions: [] };
  }

  const executedActions: Array<{
    type: string;
    data: Record<string, unknown>;
  }> = [];

  for (const action of parsed.actions) {
    try {
      switch (action.type) {
        case "create_task": {
          const task = await createTask({
            title: action.data["title"] ?? "Задача без названия",
            category: (action.data["category"] as "personal") ?? "personal",
            priority: (action.data["priority"] as "normal") ?? "normal",
            due_date: action.data["due_date"] ?? null,
            estimated_minutes: action.data["estimated_minutes"]
              ? parseInt(action.data["estimated_minutes"], 10)
              : null,
            source: "orchestrator",
            status: "todo",
          });
          executedActions.push({
            type: "create_task",
            data: { id: task.id, title: task.title },
          });
          break;
        }
        case "complete_task": {
          const match = action.data["task_title_match"];
          if (match) {
            const tasks = await getActiveTasks();
            const found = tasks.find((t) =>
              t.title.toLowerCase().includes(match.toLowerCase()),
            );
            if (found) {
              await completeTask(found.id);
              // Sync with live plan
              syncTaskCompletion(found.id).catch((err) =>
                logger.error(
                  { err },
                  "Failed to sync task completion with live plan",
                ),
              );
              executedActions.push({
                type: "complete_task",
                data: { id: found.id, title: found.title },
              });
            }
          }
          break;
        }
        case "create_client": {
          const client = await createClient({
            name: action.data["name"] ?? "Неизвестный",
            need: action.data["need"] ?? null,
            budget_range: action.data["budget_range"] ?? null,
            business_type: action.data["business_type"] ?? null,
            source: action.data["source"] ?? "conversation",
            status: "lead",
          });
          executedActions.push({
            type: "create_client",
            data: { id: client.id, name: client.name },
          });
          break;
        }
        case "note": {
          executedActions.push({
            type: "note",
            data: { content: action.data["content"] },
          });
          break;
        }
        case "manage_memory": {
          executedActions.push({
            type: "manage_memory",
            data: {
              intent: action.data["intent"] ?? "",
            },
          });
          break;
        }
        case "start_research": {
          executedActions.push({
            type: "start_research",
            data: {
              topic: action.data["topic"] ?? "",
              details: action.data["details"] ?? "",
              include_memory: action.data["include_memory"] === "true",
            },
          });
          break;
        }
        case "reorganize_plan": {
          executedActions.push({
            type: "reorganize_plan",
            data: {
              trigger: action.data["trigger"] ?? "",
            },
          });
          break;
        }
      }
    } catch (error) {
      logger.error(
        { error, actionType: action.type, actionData: action.data },
        "Failed to execute action",
      );
    }
  }

  // Run Memory Agent in background (don't wait) — only for non-memory-management messages
  const hasMemoryAction = executedActions.some(
    (a) => a.type === "manage_memory",
  );
  if (!hasMemoryAction) {
    const actionsSummary =
      executedActions
        .map((a) => `${a.type}: ${JSON.stringify(a.data)}`)
        .join("\n") || "Нет действий";

    runMemoryAgent({ message, actionsSummary }).catch((err) =>
      logger.error({ err }, "Memory agent background error"),
    );
  }

  return {
    response: parsed.response,
    actions: executedActions,
  };
}
