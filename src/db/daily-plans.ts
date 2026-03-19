import { getSupabase } from './client.js';
import type { DailyPlan } from '../types/index.js';
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
        status: plan.status,
        review: plan.review ?? null,
        productivity_score: plan.productivity_score ?? null,
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
