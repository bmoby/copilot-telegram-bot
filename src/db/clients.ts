import { getSupabase } from './client.js';
import type { Client, NewClient, ClientStatus } from '../types/index.js';
import { logger } from '../logger.js';

const TABLE = 'clients';

export async function createClient(client: Partial<NewClient> & { name: string }): Promise<Client> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      name: client.name,
      phone: client.phone ?? null,
      source: client.source ?? 'instagram',
      business_type: client.business_type ?? null,
      need: client.need ?? null,
      budget_range: client.budget_range ?? null,
      status: client.status ?? 'lead',
      qualification_data: client.qualification_data ?? null,
      proposal_url: client.proposal_url ?? null,
      assigned_to: client.assigned_to ?? null,
      project_deadline: client.project_deadline ?? null,
      amount: client.amount ?? null,
      commission_amount: client.commission_amount ?? null,
      notes: client.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error }, 'Failed to create client');
    throw error;
  }
  return data as Client;
}

export async function getClient(id: string): Promise<Client | null> {
  const db = getSupabase();
  const { data, error } = await db.from(TABLE).select().eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error({ error, id }, 'Failed to get client');
    throw error;
  }
  return data as Client;
}

export async function getClientsByStatus(status: ClientStatus): Promise<Client[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error, status }, 'Failed to get clients by status');
    throw error;
  }
  return (data ?? []) as Client[];
}

export async function getClientPipeline(): Promise<Client[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .neq('status', 'paid')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error }, 'Failed to get client pipeline');
    throw error;
  }
  return (data ?? []) as Client[];
}

export async function updateClientStatus(id: string, status: ClientStatus): Promise<Client> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error({ error, id, status }, 'Failed to update client status');
    throw error;
  }
  return data as Client;
}

export async function assignClientToMember(clientId: string, memberId: string): Promise<Client> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({
      assigned_to: memberId,
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)
    .select()
    .single();

  if (error) {
    logger.error({ error, clientId, memberId }, 'Failed to assign client');
    throw error;
  }
  return data as Client;
}

export async function updateClient(id: string, updates: Partial<Omit<Client, 'id' | 'created_at'>>): Promise<Client> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error({ error, id }, 'Failed to update client');
    throw error;
  }
  return data as Client;
}

export async function searchClientByName(name: string): Promise<Client[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select()
    .ilike('name', `%${name}%`)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error, name }, 'Failed to search client');
    throw error;
  }
  return (data ?? []) as Client[];
}
