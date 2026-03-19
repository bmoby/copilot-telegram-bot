import { getSupabase } from './client.js';
import type { DailyPlan, LivePlanTask, DailyPlanTask } from '../types/index.js';
import { logger } from '../logger.js';

const TABLE = 'daily_plans';

export async function getDailyPlan(date: string): Promise<DailyPlan | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('date', date)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error({ error, date }, 'Failed to get daily plan');
    throw error;
  }
  return data as DailyPlan;
}

export async function saveDailyPlan(plan: Omit<DailyPlan, 'id' | 'created_at'>): Promise<DailyPlan> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        date: plan.date,
        plan: plan.plan,
        live_plan: plan.live_plan ?? null,
        status: plan.status,
        review: plan.review ?? null,
        productivity_score: plan.productivity_score ?? null,
        revision_count: plan.revision_count ?? 0,
        last_reorganized_at: plan.last_reorganized_at ?? null,
      },
      { onConflict: 'date' }
    )
    .select()
    .single();

  if (error) {
    logger.error({ error }, 'Failed to save daily plan');
    throw error;
  }
  return data as DailyPlan;
}

export async function getTodayLivePlan(): Promise<LivePlanTask[] | null> {
  const today = new Date().toISOString().split('T')[0]!;
  const plan = await getDailyPlan(today);
  return plan?.live_plan ?? null;
}

export async function updateLivePlan(date: string, livePlan: LivePlanTask[], incrementRevision = false): Promise<DailyPlan> {
  const db = getSupabase();
  const updates: Record<string, unknown> = {
    live_plan: livePlan,
    last_reorganized_at: incrementRevision ? new Date().toISOString() : undefined,
  };

  if (incrementRevision) {
    // Fetch current to increment
    const current = await getDailyPlan(date);
    updates['revision_count'] = (current?.revision_count ?? 0) + 1;
  }

  // Remove undefined values
  for (const key of Object.keys(updates)) {
    if (updates[key] === undefined) delete updates[key];
  }

  const { data, error } = await db
    .from(TABLE)
    .update(updates)
    .eq('date', date)
    .select()
    .single();

  if (error) {
    logger.error({ error, date }, 'Failed to update live plan');
    throw error;
  }
  return data as DailyPlan;
}

export async function markLiveTaskStatus(
  date: string,
  taskId: string,
  status: LivePlanTask['status'],
  extra?: { skip_reason?: string; deferred_to?: string }
): Promise<DailyPlan | null> {
  const plan = await getDailyPlan(date);
  if (!plan?.live_plan) return null;

  const updated = plan.live_plan.map((t) => {
    if (t.task_id !== taskId) return t;
    return {
      ...t,
      status,
      completed_at: status === 'done' ? new Date().toISOString() : t.completed_at,
      skip_reason: extra?.skip_reason ?? t.skip_reason,
      deferred_to: extra?.deferred_to ?? t.deferred_to,
    };
  });

  return updateLivePlan(date, updated);
}

export function initLivePlanFromStatic(planTasks: DailyPlanTask[]): LivePlanTask[] {
  return planTasks.map((t) => ({
    ...t,
    status: 'pending' as const,
    scheduled_time: null,
    completed_at: null,
    deferred_to: null,
    skip_reason: null,
  }));
}

export async function updateDailyPlanReview(
  date: string,
  review: string,
  score: number
): Promise<DailyPlan> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({
      review,
      productivity_score: score,
      status: 'completed',
    })
    .eq('date', date)
    .select()
    .single();

  if (error) {
    logger.error({ error, date }, 'Failed to update daily plan review');
    throw error;
  }
  return data as DailyPlan;
}
