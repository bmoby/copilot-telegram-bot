import { askClaude } from './client.js';
import { buildContext } from './context-builder.js';
import { getDailyPlan, updateLivePlan, initLivePlanFromStatic } from '../db/daily-plans.js';
import { getActiveTasks, getOverdueTasks } from '../db/tasks.js';
import { generateDailyPlan } from './planner.js';
import type { LivePlanTask } from '../types/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayDateString, getDayOfWeek } from '../utils/format.js';

const REORGANIZER_PROMPT = `Tu es le reorganisateur de journee de {ownerName}.

{context}

SITUATION : Un imprevu ou changement est survenu. Tu dois REORGANISER le reste de la journee.

PLAN ACTUEL DU JOUR :
{livePlan}

EVENEMENT DECLENCHEUR :
{trigger}

HEURE ACTUELLE : {currentTime}

REGLES DE REORGANISATION :
1. Les taches "done" ne changent PAS
2. Les taches "in_progress" restent sauf si explicitement abandonnees
3. Reordonne les taches "pending" selon la nouvelle realite
4. Si l'utilisateur manque d'energie → mets les taches legeres en premier, reporte les lourdes
5. Si un imprevu prend du temps → decale ou reporte les taches non-urgentes
6. Si l'utilisateur veut faire autre chose → rappelle les urgences MAIS adapte-toi s'il insiste
7. Maximum 2-3 reports par jour (sinon c'est de la procrastination, dis-le gentiment)
8. Les taches urgentes avec deadline aujourd'hui ne peuvent PAS etre reportees (sauf cas de force majeure)
9. Si tu reportes, mets la date de demain (ou le prochain jour ouvre)
10. Recalcule l'ordre en fonction du temps restant dans la journee

FORMAT DE REPONSE (JSON strict) :
{
  "reorganized_plan": [
    {
      "task_id": "string",
      "title": "string",
      "category": "string",
      "priority": "string",
      "estimated_minutes": number | null,
      "time_slot": "urgent" | "important" | "optional",
      "order": number,
      "status": "pending" | "in_progress" | "done" | "skipped" | "deferred",
      "scheduled_time": "HH:MM" | null,
      "completed_at": "ISO" | null,
      "deferred_to": "YYYY-MM-DD" | null,
      "skip_reason": "string" | null
    }
  ],
  "explanation": "Explication courte (2-3 lignes) de ce qui a change et pourquoi",
  "warnings": ["string"]
}

IMPORTANT pour "warnings" :
- Si des taches urgentes sont reportees, mets un warning
- Si l'utilisateur reporte trop (3+), avertis gentiment
- Si le plan devient irrealiste (trop de taches pour le temps restant), dis-le`;

export interface ReorganizeResult {
  livePlan: LivePlanTask[];
  explanation: string;
  warnings: string[];
}

export async function reorganizePlan(trigger: string): Promise<ReorganizeResult> {
  const today = todayDateString();
  let plan = await getDailyPlan(today);

  // If no plan exists yet, generate one first
  if (!plan) {
    const activeTasks = await getActiveTasks();
    const overdueTasks = await getOverdueTasks();
    const planTasks = await generateDailyPlan({
      activeTasks,
      overdueTasks,
      dayOfWeek: getDayOfWeek(),
      sportDoneRecently: false,
    });

    const { saveDailyPlan } = await import('../db/daily-plans.js');
    plan = await saveDailyPlan({
      date: today,
      plan: planTasks,
      live_plan: initLivePlanFromStatic(planTasks),
      status: 'active',
      review: null,
      productivity_score: null,
      revision_count: 0,
      last_reorganized_at: null,
    });
  }

  // Ensure live_plan exists
  if (!plan.live_plan) {
    plan.live_plan = initLivePlanFromStatic(plan.plan);
    await updateLivePlan(today, plan.live_plan);
  }

  const context = await buildContext();
  const now = new Date();
  const currentTime = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const livePlanStr = plan.live_plan
    .map((t) => `  ${t.order}. [${t.status}] ${t.title} (${t.priority}, ${t.estimated_minutes ?? '?'} min)${t.scheduled_time ? ` @${t.scheduled_time}` : ''}${t.deferred_to ? ` → reporte ${t.deferred_to}` : ''}`)
    .join('\n');

  const systemPrompt = REORGANIZER_PROMPT
    .replaceAll('{ownerName}', config.ownerName)
    .replace('{context}', context)
    .replace('{livePlan}', livePlanStr)
    .replace('{trigger}', trigger)
    .replace('{currentTime}', currentTime);

  const response = await askClaude({
    prompt: `Reorganise le plan du jour suite a cet evenement : ${trigger}`,
    systemPrompt,
    model: 'sonnet',
  });

  let jsonString = response.trim();
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonString) as {
      reorganized_plan: LivePlanTask[];
      explanation: string;
      warnings: string[];
    };

    const newPlan = parsed.reorganized_plan;
    await updateLivePlan(today, newPlan, true);

    logger.info(
      { taskCount: newPlan.length, revision: (plan.revision_count ?? 0) + 1 },
      'Plan reorganized'
    );

    return {
      livePlan: newPlan,
      explanation: parsed.explanation,
      warnings: parsed.warnings ?? [],
    };
  } catch {
    logger.error({ response: jsonString.slice(0, 500) }, 'Failed to parse reorganization response');
    return {
      livePlan: plan.live_plan,
      explanation: 'Erreur lors de la reorganisation. Le plan reste inchange.',
      warnings: [],
    };
  }
}

/**
 * Sync live plan when a task is completed via the orchestrator.
 * Marks the task as done in the live plan automatically.
 */
export async function syncTaskCompletion(taskId: string): Promise<void> {
  const today = todayDateString();
  const plan = await getDailyPlan(today);
  if (!plan?.live_plan) return;

  const taskInPlan = plan.live_plan.find((t) => t.task_id === taskId);
  if (!taskInPlan || taskInPlan.status === 'done') return;

  const updated = plan.live_plan.map((t) => {
    if (t.task_id !== taskId) return t;
    return {
      ...t,
      status: 'done' as const,
      completed_at: new Date().toISOString(),
    };
  });

  await updateLivePlan(today, updated);
  logger.info({ taskId }, 'Live plan synced after task completion');
}
