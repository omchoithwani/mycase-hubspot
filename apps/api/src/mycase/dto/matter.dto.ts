export interface McCustomFieldValue {
  custom_field: { id: number };
  value: string | number | boolean;
}

export interface McMatter {
  id: string | number;
  name: string;
  case_number?: string;
  status?: string;         // 'open' | 'closed'
  case_stage?: string;
  practice_area?: string;
  description?: string;
  opened_date?: string;    // ISO date
  sol_date?: string;       // ISO date
  outstanding_balance?: number;
  clients?: Array<{ id: number }>;
  custom_field_values?: McCustomFieldValue[];
  created_at?: string;
  updated_at?: string;
}

export interface McMatterInput {
  name: string;
  case_number?: string;
  status?: string;
  case_stage?: string;
  practice_area?: string;
  description?: string;
  opened_date?: string;
  sol_date?: string;
  rate?: number;
  outstanding_balance?: number;
  clients?: Array<{ id: number }>;
  custom_field_values?: McCustomFieldValue[];
}

export const MYCASE_MATTER_STATUSES = ['open', 'closed'] as const;
export type MyCaseMatterStatus = typeof MYCASE_MATTER_STATUSES[number];
