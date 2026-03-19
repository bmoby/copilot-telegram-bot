import { askClaude } from './client.js';
import { buildContext } from './context-builder.js';
import { getMemoryByCategory } from '../db/memory.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface PlannedNotification {
  time: string; // HH:MM format
  message: string;
  type: string;
}

const PLANNER_SYSTEM_PROMPT = `Tu es le systeme de notifications intelligent de {ownerName}, son copilote personnel.

Ton role : planifier exactement {count} notifications pour la journee d'aujourd'hui.

{context}

REGLES DE DISTRIBUTION :
- Distribue les notifications entre 08:30 et 23:30
- Espace MINIMUM de 20 minutes entre deux notifications
- Concentre plus de notifications pendant la "fenetre d'or" (10h-15h) — c'est sa periode la plus productive
- Notifications moderees le matin (8h30-10h) : demarrage en douceur
- Plus de notifications en debut d'apres-midi (14h-16h) : relance apres la pause
- Moins de notifications le soir (apres 20h) : seulement 2-3 max
- UNE notification entre 23h-23h30 pour le sommeil

TYPES DE NOTIFICATIONS :
- morning_start : demarrage journee, plan, energie
- progress_check : avancement sur une tache SPECIFIQUE (mentionne le nom !)
- focus_probe : verifier la concentration
- blocker_check : detecter les blocages
- client_followup : suivi client
- motivation : anti-procrastination
- planning : reorganiser, prochaine etape
- accountability : demander des comptes
- reflection : apprentissage
- evening_review : bilan
- sleep_reminder : sommeil

REGLES SUR LES MESSAGES :
- COURTS : 1-3 lignes max
- Ton DIRECT, amical, parfois cash (pas corporate)
- Les questions doivent POUSSER {ownerName} a repondre (pas juste lire et ignorer)
- Reference ses VRAIES taches et clients par nom
- Utilise des emojis avec parcimonie (1 par message max)
- Varie les types — pas 3 progress_check d'affilee
- Les messages du matin sont energiques, ceux du soir plus calmes
- Si il a des taches urgentes, les mentionner plus souvent
- Si il a des clients en attente, insister sur le suivi

FORMAT DE REPONSE (JSON strict, pas de markdown autour) :
[
  {
    "time": "HH:MM",
    "message": "Le message exact a envoyer",
    "type": "le_type"
  }
]

IMPORTANT : genere EXACTEMENT {count} notifications. Pas plus, pas moins.`;

export async function planDailyNotifications(notificationCount: number): Promise<PlannedNotification[]> {
  const context = await buildContext();

  const systemPrompt = PLANNER_SYSTEM_PROMPT
    .replaceAll('{ownerName}', config.ownerName)
    .replaceAll('{count}', String(notificationCount))
    .replace('{context}', context);

  const response = await askClaude({
    prompt: `Planifie exactement ${notificationCount} notifications intelligentes pour aujourd'hui. Retourne le JSON.`,
    systemPrompt,
    model: 'sonnet',
    maxTokens: 4096,
  });

  let jsonString = response.trim();
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const notifications = JSON.parse(jsonString) as PlannedNotification[];

    const valid = notifications.filter(
      (n) => n.time && n.message && n.type && /^\d{2}:\d{2}$/.test(n.time)
    );

    if (valid.length === 0) {
      logger.error('No valid notifications in planner response');
      return [];
    }

    valid.sort((a, b) => a.time.localeCompare(b.time));

    logger.info({ planned: valid.length, requested: notificationCount }, 'Daily notifications planned');
    return valid;
  } catch {
    logger.error({ response: jsonString.slice(0, 500) }, 'Failed to parse notification plan JSON');
    return [];
  }
}

export async function getNotificationCount(): Promise<number> {
  try {
    const preferences = await getMemoryByCategory('preference');
    const notifPref = preferences.find(
      (m) => m.key === 'notifications_par_jour'
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
