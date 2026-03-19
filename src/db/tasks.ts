import { getSupabase } from './client.js';
import type { Task, NewTask, TaskStatus, TaskCategory } from '../types/index.js';
import { logger } from '../logger.js';

const TABLE = 'tasks';

export async function createTask(task: Partial<NewTask> & { title: string }): Promise<Task> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      title: task.title,
      description: task.description ?? null,
      category: task.category ?? 'personal',
      priority: task.priority ?? 'normal',
      status: task.status ?? 'todo',
      due_date: task.due_date ?? null,
      due_time: task.due_time ?? null,
      estimated_minutes: task.estimated_minutes ?? null,
      source: task.source ?? 'manual',
      related_id: task.related_id ?? null,
      related_type: task.related_type ?? null,
      notes: task.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error }, 'Failed to create task');
    throw error;
  }
  return data as Task;
}

export async function getTask(id: string): Promise<Task | null> {
  const db = getSupabase();
  const { data, error } = await db.from(TABLE).select().eq('id', id).single();
  if (error) {
    logger.error({ error, id }, 'Failed to get task');
    return null;
  }
  return data as Task;
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error({ error, id }, 'Failed to update task');
    throw error;
  }
  return data as Task;
}

export async function completeTask(id: string): Promise<Task> {
  return updateTask(id, {
    status: 'done',
    completed_at: new Date().toISOString(),
  });
}

export async function getTasksByStatus(status: TaskStatus): Promise<Task[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('status', status)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) {
    logger.error({ error, status }, 'Failed to get tasks by status');
    throw error;
  }
  return (data ?? []) as Task[];
}

export async function getTasksByCategory(category: TaskCategory): Promise<Task[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('category', category)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .order('priority', { ascending: true });

  if (error) {
    logger.error({ error, category }, 'Failed to get tasks by category');
    throw error;
  }
  return (data ?? []) as Task[];
}

export async function getTasksDueToday(): Promise<Task[]> {
  const today = new Date().toISOString().split('T')[0]!;
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .lte('due_date', today)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .order('priority', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get tasks due today');
    throw error;
  }
  return (data ?? []) as Task[];
}

export async function getOverdueTasks(): Promise<Task[]> {
  const today = new Date().toISOString().split('T')[0]!;
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .lt('due_date', today)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get overdue tasks');
    throw error;
  }
  return (data ?? []) as Task[];
}

export async function getActiveTasks(): Promise<Task[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) {
    logger.error({ error }, 'Failed to get active tasks');
    throw error;
  }
  return (data ?? []) as Task[];
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  important: 1,
  normal: 2,
  low: 3,
};

export async function getNextTask(): Promise<Task | null> {
  const tasks = await getActiveTasks();
  if (tasks.length === 0) return null;

  const sorted = tasks.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  return sorted[0] ?? null;
}

export async function deleteTask(id: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) {
    logger.error({ error, id }, 'Failed to delete task');
    throw error;
  }
}
