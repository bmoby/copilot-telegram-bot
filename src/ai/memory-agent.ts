import { askClaude } from './client.js';
import { getCoreMemory, getWorkingMemory, upsertMemory, deleteMemory, type MemoryEntry } from '../db/memory.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const MEMORY_AGENT_PROMPT = `Tu es l'Agent Memoire. Tu analyses les messages de {ownerName} et determines si la memoire a long terme doit etre mise a jour.

MEMOIRE ACTUELLE :
{memory}

MESSAGE DE {ownerName} :
{message}

ACTIONS DEJA PRISES PAR LE SYSTEME :
{actions}

REGLES :
- Ne mets a jour que quand c'est SIGNIFICATIF (pas pour des banalites)
- Categories possibles : identity, situation, preference, relationship, lesson
- "identity" = personnalite, competences, fonctionnement (change rarement) → TIER CORE (permanent)
- "situation" = activites en cours, equipe, objectifs, finances → TIER WORKING (expire apres 30j)
- "preference" = gouts, methodes preferees → TIER WORKING (expire apres 30j)
- "relationship" = info sur une personne specifique (nom = cle) → TIER WORKING (expire apres 30j)
- "lesson" = experience, erreur passee, chose apprise → TIER ARCHIVAL (permanent, recherche semantique)
- Pour les relationships, utilise le nom de la personne comme "key"
- Si une info existante est devenue obsolete, mets-la a jour
- Si une info est completement fausse maintenant, supprime-la

Reponds UNIQUEMENT en JSON (pas de markdown) :
{
  "updates": [
    {
      "action": "create" | "update" | "delete",
      "category": "identity|situation|preference|relationship|lesson",
      "key": "identifiant_court",
      "content": "le contenu a stocker",
      "reason": "pourquoi cette mise a jour"
    }
  ]
}

Si RIEN a mettre a jour, reponds : { "updates": [] }`;

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

    const prompt = MEMORY_AGENT_PROMPT
      .replaceAll('{ownerName}', config.ownerName)
      .replace('{memory}', memoryFormatted)
      .replace('{message}', params.message)
      .replace('{actions}', params.actionsSummary);

    const response = await askClaude({
      prompt: 'Analyse ce message et mets a jour la memoire si necessaire.',
      systemPrompt: prompt,
      model: 'sonnet',
      maxTokens: 1024,
    });

    let jsonString = response.trim();
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonString) as {
      updates: Array<{
        action: 'create' | 'update' | 'delete';
        category: string;
        key: string;
        content?: string;
        reason?: string;
      }>;
    };

    if (parsed.updates.length === 0) {
      logger.debug('Memory agent: no updates needed');
      return;
    }

    for (const update of parsed.updates) {
      try {
        if (update.action === 'delete') {
          await deleteMemory(update.category as 'identity' | 'situation' | 'preference' | 'relationship' | 'lesson', update.key);
          logger.info({ category: update.category, key: update.key, reason: update.reason }, 'Memory deleted by agent');
        } else {
          await upsertMemory({
            category: update.category as 'identity' | 'situation' | 'preference' | 'relationship' | 'lesson',
            key: update.key,
            content: update.content ?? '',
            source: 'memory_agent',
          });
          logger.info({ action: update.action, category: update.category, key: update.key, reason: update.reason }, 'Memory updated by agent');
        }
      } catch (error) {
        logger.error({ error, update }, 'Failed to execute memory update');
      }
    }

    logger.info({ count: parsed.updates.length }, 'Memory agent completed');
  } catch (error) {
    logger.error({ error }, 'Memory agent failed');
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

  let result = '';
  for (const [category, items] of Object.entries(grouped)) {
    result += `\n[${category.toUpperCase()}]\n`;
    for (const item of items) {
      result += `- ${item.key}: ${item.content}\n`;
    }
  }
  return result || '(vide)';
}
