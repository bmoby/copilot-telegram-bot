import { getCoreMemory, getWorkingMemory, computeDecay, type MemoryEntry } from '../db/memory.js';
import { getActiveTasks } from '../db/tasks.js';
import { getClientPipeline } from '../db/clients.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface BuildContextOptions {
  maxTasks?: number;
  userMessage?: string;
}

export async function buildContext(options?: BuildContextOptions): Promise<string> {
  try {
    const maxTasks = options?.maxTasks ?? 15;

    const [coreMemory, workingMemory] = await Promise.all([
      getCoreMemory(),
      getWorkingMemory(),
    ]);

    const [activeTasks, clients] = await Promise.all([
      getActiveTasks(),
      getClientPipeline(),
    ]);

    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let context = '';

    // Core memory (identity — always present, no decay)
    if (coreMemory.length > 0) {
      context += `QUI EST ${config.ownerName.toUpperCase()} :\n`;
      context += formatEntries(coreMemory);
      context += '\n';
    }

    // Working memory — sorted by freshness (temporal decay)
    if (workingMemory.length > 0) {
      const withDecay = workingMemory.map((m) => ({
        entry: m,
        decay: computeDecay(m.last_confirmed),
      }));
      withDecay.sort((a, b) => b.decay - a.decay);

      const fresh = withDecay.filter((d) => d.decay > 0.5);
      const fading = withDecay.filter((d) => d.decay <= 0.5);

      const freshByCategory = groupByCategory(fresh.map((d) => d.entry));

      if (freshByCategory.situation.length > 0) {
        context += 'SITUATION ACTUELLE :\n';
        context += formatEntries(freshByCategory.situation);
        context += '\n';
      }

      if (freshByCategory.preference.length > 0) {
        context += 'PREFERENCES ET FONCTIONNEMENT :\n';
        context += formatEntries(freshByCategory.preference);
        context += '\n';
      }

      if (freshByCategory.relationship.length > 0) {
        context += 'PERSONNES CONNUES :\n';
        context += formatEntries(freshByCategory.relationship);
        context += '\n';
      }

      if (fading.length > 0) {
        const fadingKeys = fading.map((d) => d.entry.key).join(', ');
        context += `MEMOIRE ANCIENNE (${fading.length}, confirmee il y a >30j) : ${fadingKeys}\n\n`;
      }
    }

    // Live tasks
    context += `TACHES ACTIVES (${activeTasks.length}) :\n`;
    if (activeTasks.length === 0) {
      context += '- Aucune tache\n';
    } else {
      for (const t of activeTasks.slice(0, maxTasks)) {
        const due = t.due_date ? ` (deadline: ${t.due_date})` : '';
        context += `- [${t.priority}] ${t.title} (${t.category})${due}\n`;
      }
      if (activeTasks.length > maxTasks) {
        context += `  ... et ${activeTasks.length - maxTasks} autres\n`;
      }
    }
    context += '\n';

    // Live clients
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const terminalStatuses = new Set(['delivered', 'paid']);
    const activeClients = clients.filter((c) => {
      if (!terminalStatuses.has(c.status)) return true;
      return new Date(c.updated_at) > sevenDaysAgo;
    });

    context += `CLIENTS (${activeClients.length}) :\n`;
    if (activeClients.length === 0) {
      context += '- Aucun client dans le pipeline\n';
    } else {
      for (const c of activeClients) {
        context += `- ${c.name} [${c.status}]${c.need ? ` - ${c.need}` : ''}${c.budget_range ? ` (${c.budget_range})` : ''}\n`;
      }
    }
    context += '\n';

    // Temporal
    context += `DATE ET HEURE : ${dateStr}, ${timeStr}\n`;

    return context;
  } catch (error) {
    logger.error({ error }, 'Failed to build context');
    return 'Erreur lors de la construction du contexte. Donnees live indisponibles.';
  }
}

function formatEntries(entries: MemoryEntry[]): string {
  return entries.map((e) => `- ${e.key}: ${e.content}`).join('\n') + '\n';
}

interface GroupedEntries {
  situation: MemoryEntry[];
  preference: MemoryEntry[];
  relationship: MemoryEntry[];
}

function groupByCategory(entries: MemoryEntry[]): GroupedEntries {
  const result: GroupedEntries = { situation: [], preference: [], relationship: [] };
  for (const entry of entries) {
    if (entry.category in result) {
      result[entry.category as keyof GroupedEntries].push(entry);
    }
  }
  return result;
}
