-- ============================================
-- Copilot Bot — Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com)
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TASKS
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'personal'
    CHECK (category IN ('client', 'student', 'content', 'personal', 'dev', 'team')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('urgent', 'important', 'normal', 'low')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  due_date TIMESTAMPTZ,
  due_time TEXT,
  estimated_minutes INTEGER,
  completed_at TIMESTAMPTZ,
  source TEXT DEFAULT 'manual',
  related_id UUID,
  related_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DAILY PLANS
-- ============================================
CREATE TABLE IF NOT EXISTS daily_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE UNIQUE NOT NULL,
  plan JSONB NOT NULL DEFAULT '[]',
  live_plan JSONB,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'active', 'completed')),
  review TEXT,
  productivity_score INTEGER CHECK (productivity_score BETWEEN 1 AND 10),
  revision_count INTEGER DEFAULT 0,
  last_reorganized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CLIENTS
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT,
  source TEXT DEFAULT 'instagram',
  business_type TEXT,
  need TEXT,
  budget_range TEXT,
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead', 'qualified', 'proposal_sent', 'accepted', 'in_progress', 'delivered', 'paid')),
  qualification_data JSONB,
  proposal_url TEXT,
  assigned_to UUID,
  project_deadline TIMESTAMPTZ,
  amount DECIMAL,
  commission_amount DECIMAL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TEAM MEMBERS
-- ============================================
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  discord_id TEXT,
  telegram_id TEXT,
  phone TEXT,
  skills JSONB,
  availability TEXT DEFAULT 'available'
    CHECK (availability IN ('available', 'busy', 'unavailable')),
  current_project_id UUID,
  total_projects INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign key for clients.assigned_to -> team_members
ALTER TABLE clients
  ADD CONSTRAINT fk_clients_assigned_to
  FOREIGN KEY (assigned_to) REFERENCES team_members(id);

-- ============================================
-- MEMORY (3-tier: core/working/archival)
-- ============================================
CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL
    CHECK (category IN ('identity', 'situation', 'preference', 'relationship', 'lesson')),
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence DECIMAL DEFAULT 1.0,
  source TEXT DEFAULT 'conversation',
  tier TEXT DEFAULT 'working'
    CHECK (tier IN ('core', 'working', 'archival')),
  last_confirmed TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, key)
);

-- ============================================
-- REMINDERS (notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  trigger_at TIMESTAMPTZ NOT NULL,
  repeat TEXT DEFAULT 'once'
    CHECK (repeat IN ('once', 'daily', 'weekly', 'custom')),
  repeat_config JSONB,
  channel TEXT DEFAULT 'telegram',
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'sent', 'cancelled')),
  task_id UUID REFERENCES tasks(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_category ON tasks(category);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_daily_plans_date ON daily_plans(date);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_reminders_trigger ON reminders(trigger_at) WHERE status = 'active';
CREATE INDEX idx_memory_category ON memory(category);
CREATE INDEX idx_memory_key ON memory(key);
CREATE INDEX idx_memory_tier ON memory(tier);
CREATE INDEX idx_memory_tier_category ON memory(tier, category);
CREATE INDEX idx_memory_expires_at ON memory(expires_at) WHERE expires_at IS NOT NULL;
