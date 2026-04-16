export interface McMatter {
  id: string;
  name: string;
  status: string; // 'Open' | 'Closed' | 'Pending' | etc.
  client_id: string;
  description?: string;
  open_date?: string;   // ISO date string
  close_date?: string;  // ISO date string
  rate?: number;        // billing rate in cents or dollars depending on firm settings
  created_at?: string;
  updated_at?: string;
}

export interface McMatterInput {
  name: string;
  status?: string;
  client_id: string;
  description?: string;
  open_date?: string;
  close_date?: string;
  rate?: number;
}

export const MYCASE_MATTER_STATUSES = [
  'Open',
  'Closed',
  'Pending',
  'On Hold',
  'Archived',
] as const;

export type MyCaseMatterStatus = typeof MYCASE_MATTER_STATUSES[number];
