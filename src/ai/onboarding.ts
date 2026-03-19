import { askClaude } from './client.js';
import { getCoreMemory, getWorkingMemory, upsertMemory } from '../db/memory.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

// ---------- Onboarding steps ----------

interface OnboardingStep {
  key: string;
  question: string;
  systemPrompt: string;
}

const STEPS: OnboardingStep[] = [
  {
    key: 'identity',
    question:
      `Salut ! Je suis ton ${config.botName} — ton assistant personnel intelligent.\n\n` +
      `Avant de commencer, j'aimerais apprendre a te connaitre pour etre tout de suite efficace.\n\n` +
      `Parle-moi de toi : comment tu t'appelles, ce que tu fais dans la vie, ta situation pro (freelance, salarie, etudiant...) ?`,
    systemPrompt: `Tu analyses la reponse de l'utilisateur pour en extraire des informations d'identite.
Extrais : prenom, metier/activite, situation professionnelle, competences mentionnees, personnalite visible.

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "memories": [
    { "category": "identity", "key": "identifiant_court", "content": "description claire" }
  ],
  "summary": "phrase courte confirmant ce que tu as compris"
}

Exemples de keys : "prenom", "metier", "situation_pro", "competences", "personnalite".
Ne cree une entree que si l'info est clairement donnee. Pas d'invention.`,
  },
  {
    key: 'activities',
    question:
      `Top, je note !\n\n` +
      `Maintenant, parle-moi de tes activites au quotidien. Quels types de taches tu fais regulierement ?\n` +
      `(clients, cours, dev, creation de contenu, sport, admin, gestion d'equipe...)`,
    systemPrompt: `Tu analyses la reponse de l'utilisateur pour en extraire ses activites quotidiennes et recurrentes.
Extrais : types de taches, frequence, activites principales, activites secondaires.

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "memories": [
    { "category": "situation", "key": "identifiant_court", "content": "description claire" }
  ],
  "summary": "phrase courte confirmant ce que tu as compris"
}

Exemples de keys : "activites_principales", "taches_recurrentes", "sport", "gestion_clients", "formation".
Utilise la category "situation" pour les activites courantes, "identity" pour les traits permanents.
Ne cree une entree que si l'info est clairement donnee.`,
  },
  {
    key: 'challenges',
    question:
      `Tres bien !\n\n` +
      `Et c'est quoi tes plus grosses problematiques au quotidien ?\n` +
      `(organisation, procrastination, trop de choses a gerer, difficulte a prioriser, oublis...)`,
    systemPrompt: `Tu analyses la reponse de l'utilisateur pour en extraire ses problematiques et defis quotidiens.
Extrais : problemes d'organisation, blocages, points faibles reconnus, besoins.

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "memories": [
    { "category": "identity|situation", "key": "identifiant_court", "content": "description claire" }
  ],
  "summary": "phrase courte empathique montrant que tu comprends"
}

Exemples de keys : "probleme_organisation", "blocages", "points_faibles", "besoins_aide".
Utilise "identity" pour les traits de caractere (ex: tendance a procrastiner), "situation" pour les problemes contextuels.`,
  },
  {
    key: 'rhythm',
    question:
      `Je comprends, c'est exactement pour ca que je suis la !\n\n` +
      `Parlons de ton rythme : tu es plutot du matin ou du soir ?\n` +
      `C'est quoi tes horaires de travail ? Quand tu es le plus productif ?`,
    systemPrompt: `Tu analyses la reponse de l'utilisateur pour en extraire son rythme de vie et ses horaires.
Extrais : chronotype (matin/soir), horaires de travail, pics de productivite, habitudes.

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "memories": [
    { "category": "preference|identity", "key": "identifiant_court", "content": "description claire" }
  ],
  "summary": "phrase courte confirmant le rythme compris"
}

Exemples de keys : "chronotype", "horaires_travail", "pic_productivite", "routine".
Utilise "preference" pour les choix, "identity" pour les traits naturels.`,
  },
  {
    key: 'expectations',
    question:
      `Parfait !\n\n` +
      `Derniere question : tu veux que je sois comment avec toi ?\n` +
      `- Plutot strict et cadrant, ou souple et suggestif ?\n` +
      `- Beaucoup de rappels ou juste l'essentiel ?\n` +
      `- Un ton pro ou decontracte ?`,
    systemPrompt: `Tu analyses la reponse de l'utilisateur pour en extraire ses preferences d'interaction avec le bot.
Extrais : style de communication souhaite, frequence de notifications, niveau de rigueur voulu.

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "memories": [
    { "category": "preference", "key": "identifiant_court", "content": "description claire" }
  ],
  "summary": "phrase courte confirmant le style compris"
}

Exemples de keys : "style_communication", "frequence_rappels", "niveau_rigueur", "ton_prefere".`,
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
    const [core, working] = await Promise.all([getCoreMemory(), getWorkingMemory()]);
    const total = core.length + working.length;

    // If less than 3 memory entries, onboarding is needed
    if (total < 3) return true;

    // Check if we have basic identity info
    const hasIdentity = core.some(
      (m) => m.category === 'identity' && ['prenom', 'metier', 'situation_pro'].includes(m.key)
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
  userMessage: string
): Promise<{ reply: string; done: boolean }> {
  const state = onboardingStates.get(chatId);
  if (!state || state.completed) {
    return { reply: '', done: true };
  }

  const currentStep = STEPS[state.stepIndex]!;

  try {
    // Use Claude to extract memories from the response
    const response = await askClaude({
      prompt: userMessage,
      systemPrompt: currentStep.systemPrompt,
      model: 'sonnet',
      maxTokens: 1024,
    });

    let jsonString = response.trim();
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
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
        category: mem.category as 'identity' | 'situation' | 'preference' | 'relationship' | 'lesson',
        key: mem.key,
        content: mem.content,
        source: 'onboarding',
      });
      logger.info({ category: mem.category, key: mem.key }, 'Onboarding memory saved');
    }

    // Move to next step
    state.stepIndex++;

    if (state.stepIndex >= STEPS.length) {
      // Onboarding complete
      state.completed = true;
      onboardingStates.delete(chatId);

      const doneMessage =
        `${parsed.summary}\n\n` +
        `C'est bon, je te connais maintenant ! Je suis pret a t'aider.\n\n` +
        `Tu peux me parler librement ou utiliser les commandes :\n` +
        `/plan — Plan du jour\n` +
        `/next — Prochaine tache\n` +
        `/add [texte] — Ajouter une tache\n` +
        `/tasks — Toutes les taches\n\n` +
        `Dis-moi ce que tu veux faire.`;

      return { reply: doneMessage, done: true };
    }

    // Send summary + next question
    const nextStep = STEPS[state.stepIndex]!;
    const reply = `${parsed.summary}\n\n${nextStep.question}`;

    return { reply, done: false };
  } catch (error) {
    logger.error({ error, step: currentStep.key }, 'Onboarding step processing failed');

    // Don't block — skip to next step
    state.stepIndex++;
    if (state.stepIndex >= STEPS.length) {
      state.completed = true;
      onboardingStates.delete(chatId);
      return {
        reply: `Pas de souci, on peut commencer ! Tu peux toujours me parler de toi plus tard, j'apprendrai au fil du temps.\n\nDis-moi ce que tu veux faire.`,
        done: true,
      };
    }

    const nextStep = STEPS[state.stepIndex]!;
    return {
      reply: `Bien note !\n\n${nextStep.question}`,
      done: false,
    };
  }
}
