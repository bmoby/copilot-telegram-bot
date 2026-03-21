import { askClaude } from "./client.js";
import { buildContext } from "./context-builder.js";
import { getMemoryByCategory } from "../db/memory.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface PlannedNotification {
  time: string; // HH:MM format
  message: string;
  type: string;
}

const PLANNER_SYSTEM_PROMPT = `Ты — система умных уведомлений {ownerName}, его личный копилот.

Твоя роль: запланировать ровно {count} уведомлений на сегодня.

{context}

ПРАВИЛА РАСПРЕДЕЛЕНИЯ:
- Распределяй уведомления между 08:30 и 23:30
- МИНИМУМ 20 минут между двумя уведомлениями
- Больше уведомлений во время "золотого окна" (10ч-15ч) — это его самый продуктивный период
- Умеренные уведомления утром (8ч30-10ч): мягкий старт
- Больше уведомлений в начале дня (14ч-16ч): перезапуск после паузы
- Меньше уведомлений вечером (после 20ч): максимум 2-3
- ОДНО уведомление между 23ч-23ч30 про сон

ТИПЫ УВЕДОМЛЕНИЙ:
- morning_start: начало дня, план, энергия
- progress_check: прогресс по КОНКРЕТНОЙ задаче (упомяни название!)
- focus_probe: проверить концентрацию
- blocker_check: обнаружить блокеры
- client_followup: работа с клиентом
- motivation: против прокрастинации
- planning: реорганизация, следующий шаг
- accountability: спросить отчёт
- reflection: обучение
- evening_review: итоги
- sleep_reminder: сон

ПРАВИЛА СООБЩЕНИЙ:
- КОРОТКИЕ: 1-3 строки макс
- Тон ПРЯМОЙ, дружелюбный, иногда резкий (не корпоративный)
- Вопросы должны ПОДТАЛКИВАТЬ {ownerName} отвечать (не просто читать и игнорировать)
- Упоминай его РЕАЛЬНЫЕ задачи и клиентов по имени
- Используй эмодзи умеренно (1 на сообщение макс)
- Чередуй типы — не 3 progress_check подряд
- Утренние сообщения энергичные, вечерние — спокойнее
- Если есть срочные задачи — упоминай их чаще
- Если есть клиенты на ожидании — настаивай на follow-up

ФОРМАТ ОТВЕТА (строгий JSON, без markdown вокруг):
[
  {
    "time": "HH:MM",
    "message": "Точное сообщение для отправки",
    "type": "тип"
  }
]

ВАЖНО: сгенерируй РОВНО {count} уведомлений. Не больше, не меньше.`;

export async function planDailyNotifications(
  notificationCount: number,
): Promise<PlannedNotification[]> {
  const context = await buildContext();

  const systemPrompt = PLANNER_SYSTEM_PROMPT.replaceAll(
    "{ownerName}",
    config.ownerName,
  )
    .replaceAll("{count}", String(notificationCount))
    .replace("{context}", context);

  const response = await askClaude({
    prompt: `Запланируй ровно ${notificationCount} умных уведомлений на сегодня. Верни JSON.`,
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

  try {
    const notifications = JSON.parse(jsonString) as PlannedNotification[];

    const valid = notifications.filter(
      (n) => n.time && n.message && n.type && /^\d{2}:\d{2}$/.test(n.time),
    );

    if (valid.length === 0) {
      logger.error("No valid notifications in planner response");
      return [];
    }

    valid.sort((a, b) => a.time.localeCompare(b.time));

    logger.info(
      { planned: valid.length, requested: notificationCount },
      "Daily notifications planned",
    );
    return valid;
  } catch {
    logger.error(
      { response: jsonString.slice(0, 500) },
      "Failed to parse notification plan JSON",
    );
    return [];
  }
}

export async function getNotificationCount(): Promise<number> {
  try {
    const preferences = await getMemoryByCategory("preference");
    const notifPref = preferences.find(
      (m) => m.key === "notifications_par_jour",
    );
    if (notifPref) {
      const match = notifPref.content.match(/(\d+)/);
      if (match?.[1]) return parseInt(match[1], 10);
    }
  } catch {
    // Default if memory not available
  }
  return 15;
}
