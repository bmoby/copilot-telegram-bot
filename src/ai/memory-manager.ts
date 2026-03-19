import { askClaude } from './client.js';
import { getCoreMemory, getWorkingMemory, getMemoryByTier, upsertMemory, deleteMemory, type MemoryCategory, type MemoryEntry } from '../db/memory.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface MemoryChange {
  table: 'memory';
  action: 'create' | 'update' | 'delete';
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

const MEMORY_MANAGER_PROMPT = `Tu es l'Agent Gestionnaire de Memoire de {ownerName} — le SEUL responsable de toute modification de la base de donnees memoire.

Tu geres la MEMOIRE PERSONNELLE (table "memory")
Informations sur {ownerName}.
Categories :
- identity = qui il est, competences, personnalite (change rarement)
- situation = activites en cours, objectifs, finances (change regulierement)
- preference = gouts, methodes, outils preferes
- relationship = infos sur des personnes specifiques (nom = cle)
- lesson = experiences, erreurs, choses apprises

=== MEMOIRE PERSONNELLE (${'{memory_count}'} entrees) ===
{memory_state}

HISTORIQUE DE CONVERSATION :
{history}

REGLES STRICTES :
1. CLES EXISTANTES : pour un update, utilise EXACTEMENT la cle existante dans la bonne categorie. JAMAIS de doublon.
2. MODIFICATIONS CHIRURGICALES : pour un update, modifie SEULEMENT la partie concernee du contenu. Garde le reste du texte INTACT.
3. VERIFICATION : montre l'ancien contenu et le nouveau dans ta reponse pour que {ownerName} voie la diff.
4. Si tu n'es PAS SUR de ce que {ownerName} veut → mets "changes": [] et pose une question precise dans "response".
5. Tu peux effectuer PLUSIEURS modifications en une seule reponse.
6. Si {ownerName} demande juste de VOIR la memoire (sans modifier) → mets "changes": [] et montre les infos demandees dans "response".

REPONSE (JSON strict, PAS de markdown autour) :
{
  "changes": [
    {
      "table": "memory",
      "action": "create" | "update" | "delete",
      "category": "...",
      "key": "la_cle_exacte",
      "old_content": "contenu actuel (null si create)",
      "new_content": "nouveau contenu COMPLET de l'entree (null si delete)",
      "reason": "pourquoi ce changement"
    }
  ],
  "response": "Message clair pour {ownerName} confirmant les modifications avec ancien → nouveau"
}`;

export async function processMemoryRequest(params: {
  userMessage: string;
  conversationHistory?: string;
}): Promise<MemoryManagerResult> {
  logger.info('Memory manager: processing request');

  const [coreMemory, workingMemory, archivalMemory] = await Promise.all([
    getCoreMemory(),
    getWorkingMemory(),
    getMemoryByTier('archival'),
  ]);

  const allMemory = [...coreMemory, ...workingMemory, ...archivalMemory];
  const memoryState = formatMemoryState(allMemory);

  const systemPrompt = MEMORY_MANAGER_PROMPT
    .replaceAll('{ownerName}', config.ownerName)
    .replace('{memory_count}', String(allMemory.length))
    .replace('{memory_state}', memoryState)
    .replace('{history}', params.conversationHistory || '(pas d\'historique)');

  const response = await askClaude({
    prompt: params.userMessage,
    systemPrompt,
    model: 'sonnet',
    maxTokens: 4096,
  });

  let jsonString = response.trim();
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  interface ParsedChange {
    table: 'memory';
    action: 'create' | 'update' | 'delete';
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
    logger.warn({ response: jsonString.substring(0, 200) }, 'Memory manager: failed to parse JSON');
    return {
      response: response.replace(/```json\s*/g, '').replace(/```/g, '').trim(),
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
      if (change.action === 'delete') {
        await deleteMemory(category, change.key);
      } else {
        await upsertMemory({
          category,
          key: change.key,
          content: change.new_content ?? '',
          source: 'memory_manager',
        });
      }

      executedChanges.push({
        table: 'memory',
        action: change.action,
        category: change.category,
        key: change.key,
        oldContent: change.old_content ?? null,
        newContent: change.new_content ?? null,
        reason: change.reason ?? '',
      });

      logger.info(
        { table: change.table, action: change.action, category: change.category, key: change.key },
        'Memory manager: change executed'
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ err: errMsg, change }, 'Memory manager: failed to execute change');
    }
  }

  logger.info({ changeCount: executedChanges.length }, 'Memory manager: completed');

  return {
    response: parsed.response,
    changes: executedChanges,
  };
}

function formatMemoryState(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '(vide)';

  const tiers = { core: [] as MemoryEntry[], working: [] as MemoryEntry[], archival: [] as MemoryEntry[] };
  for (const entry of entries) {
    const tier = entry.tier ?? 'working';
    if (tier in tiers) {
      tiers[tier as keyof typeof tiers].push(entry);
    }
  }

  let result = '';
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
    result += '\n';
  }
  return result;
}
