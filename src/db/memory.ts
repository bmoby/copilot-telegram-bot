import { getSupabase } from './client.js';
import { logger } from '../logger.js';
import type { MemoryTier } from '../types/index.js';

export type MemoryCategory = 'identity' | 'situation' | 'preference' | 'relationship' | 'lesson';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
  source: string;
  tier: MemoryTier;
  last_confirmed: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const TABLE = 'memory';

// ---------- Tier inference ----------

function inferTier(category: MemoryCategory): MemoryTier {
  if (category === 'identity') return 'core';
  if (category === 'lesson') return 'archival';
  return 'working';
}

function defaultExpiresAt(tier: MemoryTier): string | null {
  if (tier === 'working') {
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

// ---------- Existing functions ----------

export async function getAllMemory(): Promise<MemoryEntry[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .order('category')
    .order('key');

  if (error) {
    logger.error({ error }, 'Failed to get all memory');
    throw error;
  }
  return (data ?? []) as MemoryEntry[];
}

export async function getMemoryByCategory(category: MemoryCategory): Promise<MemoryEntry[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('category', category)
    .order('key');

  if (error) {
    logger.error({ error, category }, 'Failed to get memory by category');
    throw error;
  }
  return (data ?? []) as MemoryEntry[];
}

export async function getMemoryEntry(category: MemoryCategory, key: string): Promise<MemoryEntry | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('category', category)
    .eq('key', key)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error({ error, category, key }, 'Failed to get memory entry');
    throw error;
  }
  return data as MemoryEntry;
}

export async function upsertMemory(params: {
  category: MemoryCategory;
  key: string;
  content: string;
  source?: string;
  tier?: MemoryTier;
  expires_at?: string | null;
}): Promise<MemoryEntry> {
  const db = getSupabase();
  const tier = params.tier ?? inferTier(params.category);
  const expires_at = params.expires_at !== undefined ? params.expires_at : defaultExpiresAt(tier);

  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        category: params.category,
        key: params.key,
        content: params.content,
        source: params.source ?? 'conversation',
        tier,
        expires_at,
        last_confirmed: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'category,key' }
    )
    .select()
    .single();

  if (error) {
    logger.error({ error, params }, 'Failed to upsert memory');
    throw error;
  }

  logger.info({ category: params.category, key: params.key, tier }, 'Memory updated');

  return data as MemoryEntry;
}

export async function deleteMemory(category: MemoryCategory, key: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq('category', category)
    .eq('key', key);

  if (error) {
    logger.error({ error, category, key }, 'Failed to delete memory');
    throw error;
  }

  logger.info({ category, key }, 'Memory deleted');
}

// ---------- Tier-based functions ----------

export async function getMemoryByTier(tier: MemoryTier): Promise<MemoryEntry[]> {
  const db = getSupabase();
  let query = db
    .from(TABLE)
    .select()
    .eq('tier', tier)
    .order('category')
    .order('key');

  if (tier === 'working') {
    query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ error, tier }, 'Failed to get memory by tier');
    throw error;
  }
  return (data ?? []) as MemoryEntry[];
}

export async function getCoreMemory(): Promise<MemoryEntry[]> {
  return getMemoryByTier('core');
}

export async function getWorkingMemory(): Promise<MemoryEntry[]> {
  return getMemoryByTier('working');
}

export async function getExpiredMemory(): Promise<MemoryEntry[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('tier', 'working')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get expired memory');
    throw error;
  }
  return (data ?? []) as MemoryEntry[];
}

export async function moveToTier(category: MemoryCategory, key: string, newTier: MemoryTier): Promise<void> {
  const db = getSupabase();
  const updates: Record<string, unknown> = {
    tier: newTier,
    updated_at: new Date().toISOString(),
  };

  if (newTier === 'working') {
    updates['expires_at'] = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    updates['expires_at'] = null;
  }

  const { error } = await db
    .from(TABLE)
    .update(updates)
    .eq('category', category)
    .eq('key', key);

  if (error) {
    logger.error({ error, category, key, newTier }, 'Failed to move memory to tier');
    throw error;
  }
  logger.info({ category, key, newTier }, 'Memory moved to tier');
}

// ---------- Temporal Decay ----------

const DECAY_HALF_LIFE_DAYS = 30;

export function computeDecay(lastConfirmed: string, halfLifeDays = DECAY_HALF_LIFE_DAYS): number {
  const ageMs = Date.now() - new Date(lastConfirmed).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * ageDays);
}
