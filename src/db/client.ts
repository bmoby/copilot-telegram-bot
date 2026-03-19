import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabase) return supabase;

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  supabase = createClient(url, key);
  logger.info('Supabase client initialized');
  return supabase;
}
