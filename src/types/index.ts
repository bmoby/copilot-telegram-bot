// ============================================
// Task Types
// ============================================

export type TaskCategory = 'client' | 'student' | 'content' | 'personal' | 'dev' | 'team';
export type TaskPriority = 'urgent' | 'important' | 'normal' | 'low';
export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  source: string;
  related_id: string | null;
  related_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type NewTask = Omit<Task, 'id' | 'created_at' | 'updated_at' | 'completed_at'>;

// ============================================
// Daily Plan Types
// ============================================

export interface DailyPlanTask {
  task_id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  estimated_minutes: number | null;
  time_slot: 'urgent' | 'important' | 'optional';
  order: number;
}

export interface DailyPlan {
  id: string;
  date: string;
  plan: DailyPlanTask[];
  status: 'generated' | 'active' | 'completed';
  review: string | null;
  productivity_score: number | null;
  created_at: string;
}

// ============================================
// Client Types
// ============================================

export type ClientStatus = 'lead' | 'qualified' | 'proposal_sent' | 'accepted' | 'in_progress' | 'delivered' | 'paid';

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  source: string;
  business_type: string | null;
  need: string | null;
  budget_range: string | null;
  status: ClientStatus;
  qualification_data: Record<string, unknown> | null;
  proposal_url: string | null;
  assigned_to: string | null;
  project_deadline: string | null;
  amount: number | null;
  commission_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type NewClient = Omit<Client, 'id' | 'created_at' | 'updated_at'>;

// ============================================
// Team Member Types
// ============================================

export interface TeamMember {
  id: string;
  name: string;
  discord_id: string | null;
  telegram_id: string | null;
  phone: string | null;
  skills: Record<string, unknown> | null;
  availability: 'available' | 'busy' | 'unavailable';
  current_project_id: string | null;
  total_projects: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Memory Tier Types
// ============================================

export type MemoryTier = 'core' | 'working' | 'archival';

// ============================================
// Reminder Types
// ============================================

export type RepeatType = 'once' | 'daily' | 'weekly' | 'custom';

export interface Reminder {
  id: string;
  message: string;
  trigger_at: string;
  repeat: RepeatType;
  repeat_config: Record<string, unknown> | null;
  channel: 'telegram' | 'discord';
  status: 'active' | 'sent' | 'cancelled';
  task_id: string | null;
  created_at: string;
}
