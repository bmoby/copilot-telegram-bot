import { getSupabase } from './client.js';
import { logger } from '../logger.js';
import type { Reminder } from '../types/index.js';

export async function createReminder(params: {
  message: string;
  trigger_at: string;
  repeat?: string;
  repeat_config?: Record<string, unknown> | null;
  channel?: 'telegram' | 'discord';
  task_id?: string | null;
}): Promise<Reminder> {
  const db = getSupabase();
  const { data, error } = await db
    .from('reminders')
    .insert({
      message: params.message,
      trigger_at: params.trigger_at,
      repeat: params.repeat ?? 'once',
      repeat_config: params.repeat_config ?? null,
      channel: params.channel ?? 'telegram',
      task_id: params.task_id ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, params }, 'Failed to create reminder');
    throw new Error(`Failed to create reminder: ${error.message}`);
  }
  return data as Reminder;
}

export async function createReminders(
  reminders: Array<{
    message: string;
    trigger_at: string;
    repeat?: string;
    repeat_config?: Record<string, unknown> | null;
    channel?: 'telegram' | 'discord';
    task_id?: string | null;
  }>
): Promise<Reminder[]> {
  if (reminders.length === 0) return [];

  const db = getSupabase();
  const rows = reminders.map((r) => ({
    message: r.message,
    trigger_at: r.trigger_at,
    repeat: r.repeat ?? 'once',
    repeat_config: r.repeat_config ?? null,
    channel: r.channel ?? 'telegram',
    task_id: r.task_id ?? null,
  }));

  const { data, error } = await db
    .from('reminders')
    .insert(rows)
    .select();

  if (error) {
    logger.error({ error }, 'Failed to create reminders batch');
    throw new Error(`Failed to create reminders: ${error.message}`);
  }
  return (data ?? []) as Reminder[];
}

export async function getDueReminders(): Promise<Reminder[]> {
  const db = getSupabase();
  const staleThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const { data, error } = await db
    .from('reminders')
    .select('*')
    .eq('status', 'active')
    .eq('channel', 'telegram')
    .gte('trigger_at', staleThreshold.toISOString())
    .lte('trigger_at', new Date().toISOString())
    .order('trigger_at', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get due reminders');
    throw new Error(`Failed to get due reminders: ${error.message}`);
  }
  return (data ?? []) as Reminder[];
}

export async function markReminderSent(id: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('reminders')
    .update({ status: 'sent' })
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Failed to mark reminder sent');
    throw new Error(`Failed to mark reminder sent: ${error.message}`);
  }
}

export async function cancelActiveReminders(): Promise<number> {
  const db = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('status', 'active')
    .eq('channel', 'telegram')
    .lte('trigger_at', now)
    .select('id');

  if (error) {
    logger.error({ error }, 'Failed to cancel active reminders');
    throw new Error(`Failed to cancel reminders: ${error.message}`);
  }
  return data?.length ?? 0;
}

export async function expireZombieReminders(): Promise<number> {
  const db = getSupabase();
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('status', 'active')
    .lt('trigger_at', threshold)
    .select('id');

  if (error) {
    logger.error({ error }, 'Failed to expire zombie reminders');
    throw new Error(`Failed to expire zombie reminders: ${error.message}`);
  }
  const count = data?.length ?? 0;
  if (count > 0) {
    logger.info({ count }, 'Expired zombie reminders');
  }
  return count;
}

export async function getTodayReminders(): Promise<Reminder[]> {
  const db = getSupabase();
  const today = new Date().toISOString().split('T')[0]!;

  const { data, error } = await db
    .from('reminders')
    .select('*')
    .eq('channel', 'telegram')
    .gte('trigger_at', `${today}T00:00:00`)
    .lte('trigger_at', `${today}T23:59:59`)
    .order('trigger_at', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get today reminders');
    throw new Error(`Failed to get today reminders: ${error.message}`);
  }
  return (data ?? []) as Reminder[];
}
