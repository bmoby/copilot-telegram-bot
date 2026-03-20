import { askClaude } from "./client.js";
import { getCoreMemory, getWorkingMemory, upsertMemory } from "../db/memory.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

// ---------- Onboarding steps ----------

interface OnboardingStep {
  key: string;
  question: string;
  systemPrompt: string;
}

const STEPS: OnboardingStep[] = [
  {
    key: "identity",
    question:
      `Привет! Я — твой ${config.botName}, твой личный умный ассистент.\n\n` +
      `Перед тем как начать, я хочу узнать тебя получше, чтобы сразу быть полезным.\n\n` +
      `Расскажи о себе: как тебя зовут, чем занимаешься, какая у тебя профессиональная ситуация (фриланс, наёмный, студент...)?`,
    systemPrompt: `Ты анализируешь ответ пользователя, чтобы извлечь информацию о его личности.
Извлеки: имя, профессия/деятельность, профессиональная ситуация, упомянутые навыки, видимые черты характера.

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "memories": [
    { "category": "identity", "key": "короткий_идентификатор", "content": "понятное описание" }
  ],
  "summary": "короткая фраза, подтверждающая, что ты понял"
}

Примеры keys: "имя", "профессия", "ситуация_про", "навыки", "характер".
Создавай запись только если инфо чётко дана. Не придумывай.`,
  },
  {
    key: "activities",
    question:
      `Отлично, записал!\n\n` +
      `Теперь расскажи о своих ежедневных делах. Какие задачи ты делаешь регулярно?\n` +
      `(клиенты, учёба, разработка, контент, спорт, админ, управление командой...)`,
    systemPrompt: `Ты анализируешь ответ пользователя, чтобы извлечь его ежедневные и регулярные активности.
Извлеки: типы задач, частота, основные активности, побочные активности.

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "memories": [
    { "category": "situation", "key": "короткий_идентификатор", "content": "понятное описание" }
  ],
  "summary": "короткая фраза, подтверждающая, что ты понял"
}

Примеры keys: "основные_активности", "регулярные_задачи", "спорт", "работа_с_клиентами", "обучение".
Используй категорию "situation" для текущих активностей, "identity" для постоянных черт.
Создавай запись только если инфо чётко дана.`,
  },
  {
    key: "challenges",
    question:
      `Отлично!\n\n` +
      `А какие у тебя главные сложности в повседневности?\n` +
      `(организация, прокрастинация, слишком много дел, сложно расставить приоритеты, забываешь...)`,
    systemPrompt: `Ты анализируешь ответ пользователя, чтобы извлечь его проблемы и ежедневные вызовы.
Извлеки: проблемы с организацией, блокеры, признанные слабые стороны, потребности.

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "memories": [
    { "category": "identity|situation", "key": "короткий_идентификатор", "content": "понятное описание" }
  ],
  "summary": "короткая эмпатичная фраза, показывающая, что ты понимаешь"
}

Примеры keys: "проблема_организация", "блокеры", "слабые_стороны", "потребности_помощь".
Используй "identity" для черт характера (напр.: склонность к прокрастинации), "situation" для контекстных проблем.`,
  },
  {
    key: "rhythm",
    question:
      `Понимаю, именно для этого я здесь!\n\n` +
      `Поговорим о твоём ритме: ты скорее жаворонок или сова?\n` +
      `Какой у тебя рабочий график? Когда ты наиболее продуктивен?`,
    systemPrompt: `Ты анализируешь ответ пользователя, чтобы извлечь его ритм жизни и расписание.
Извлеки: хронотип (утро/вечер), рабочие часы, пики продуктивности, привычки.

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "memories": [
    { "category": "preference|identity", "key": "короткий_идентификатор", "content": "понятное описание" }
  ],
  "summary": "короткая фраза, подтверждающая понятый ритм"
}

Примеры keys: "хронотип", "рабочие_часы", "пик_продуктивности", "распорядок".
Используй "preference" для выборов, "identity" для природных черт.`,
  },
  {
    key: "expectations",
    question:
      `Отлично!\n\n` +
      `Последний вопрос: каким ты хочешь, чтобы я был?\n` +
      `- Скорее строгий и организующий, или мягкий и предлагающий?\n` +
      `- Много напоминаний или только самое важное?\n` +
      `- Профессиональный тон или расслабленный?`,
    systemPrompt: `Ты анализируешь ответ пользователя, чтобы извлечь его предпочтения по взаимодействию с ботом.
Извлеки: желаемый стиль общения, частота уведомлений, желаемый уровень строгости.

Отвечай ТОЛЬКО в JSON (без markdown):
{
  "memories": [
    { "category": "preference", "key": "короткий_идентификатор", "content": "понятное описание" }
  ],
  "summary": "короткая фраза, подтверждающая понятый стиль"
}

Примеры keys: "стиль_общения", "частота_напоминаний", "уровень_строгости", "предпочитаемый_тон".`,
  },
];

// ---------- In-memory onboarding state ----------

interface OnboardingState {
  stepIndex: number;
  completed: boolean;
}

const onboardingStates = new Map<string, OnboardingState>();

// ---------- Public API ----------

export async function needsOnboarding(): Promise<boolean> {
  try {
    const [core, working] = await Promise.all([
      getCoreMemory(),
      getWorkingMemory(),
    ]);
    const total = core.length + working.length;

    // If less than 3 memory entries, onboarding is needed
    if (total < 3) return true;

    // Check if we have basic identity info
    const hasIdentity = core.some(
      (m) =>
        m.category === "identity" &&
        [
          "имя",
          "профессия",
          "ситуация_про",
          "prenom",
          "metier",
          "situation_pro",
        ].includes(m.key),
    );
    return !hasIdentity;
  } catch {
    // DB not ready or empty — onboarding needed
    return true;
  }
}

export function isOnboarding(chatId: string): boolean {
  const state = onboardingStates.get(chatId);
  return !!state && !state.completed;
}

export function getOnboardingQuestion(chatId: string): string | null {
  const state = onboardingStates.get(chatId);
  if (!state || state.completed) return null;
  const step = STEPS[state.stepIndex];
  return step?.question ?? null;
}

export function startOnboarding(chatId: string): string {
  onboardingStates.set(chatId, { stepIndex: 0, completed: false });
  return STEPS[0]!.question;
}

export async function processOnboardingResponse(
  chatId: string,
  userMessage: string,
): Promise<{ reply: string; done: boolean }> {
  const state = onboardingStates.get(chatId);
  if (!state || state.completed) {
    return { reply: "", done: true };
  }

  const currentStep = STEPS[state.stepIndex]!;

  try {
    // Use Claude to extract memories from the response
    const response = await askClaude({
      prompt: userMessage,
      systemPrompt: currentStep.systemPrompt,
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
      memories: Array<{
        category: string;
        key: string;
        content: string;
      }>;
      summary: string;
    };

    // Store extracted memories
    for (const mem of parsed.memories) {
      await upsertMemory({
        category: mem.category as
          | "identity"
          | "situation"
          | "preference"
          | "relationship"
          | "lesson",
        key: mem.key,
        content: mem.content,
        source: "onboarding",
      });
      logger.info(
        { category: mem.category, key: mem.key },
        "Onboarding memory saved",
      );
    }

    // Move to next step
    state.stepIndex++;

    if (state.stepIndex >= STEPS.length) {
      // Onboarding complete
      state.completed = true;
      onboardingStates.delete(chatId);

      const doneMessage =
        `${parsed.summary}\n\n` +
        `Готово, теперь я тебя знаю! Я готов помогать.\n\n` +
        `Можешь писать мне свободно или использовать команды:\n` +
        `/plan — План дня\n` +
        `/next — Следующая задача\n` +
        `/add [текст] — Добавить задачу\n` +
        `/tasks — Все задачи\n\n` +
        `Скажи, что хочешь сделать.`;

      return { reply: doneMessage, done: true };
    }

    // Send summary + next question
    const nextStep = STEPS[state.stepIndex]!;
    const reply = `${parsed.summary}\n\n${nextStep.question}`;

    return { reply, done: false };
  } catch (error) {
    logger.error(
      { error, step: currentStep.key },
      "Onboarding step processing failed",
    );

    // Don't block — skip to next step
    state.stepIndex++;
    if (state.stepIndex >= STEPS.length) {
      state.completed = true;
      onboardingStates.delete(chatId);
      return {
        reply: `Не проблема, можем начинать! Ты всегда можешь рассказать о себе позже, я буду учиться со временем.\n\nСкажи, что хочешь сделать.`,
        done: true,
      };
    }

    const nextStep = STEPS[state.stepIndex]!;
    return {
      reply: `Записал!\n\n${nextStep.question}`,
      done: false,
    };
  }
}
