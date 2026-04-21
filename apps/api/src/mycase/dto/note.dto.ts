export interface McNote {
  id: string | number;
  subject: string;
  note: string;
  date?: string | null;
  archived?: boolean;
  client?: { id: number } | null;
  company?: { id: number } | null;
  case?: { id: number } | null;
  created_at?: string;
  updated_at?: string;
}

export interface McNoteInput {
  subject: string;
  note: string;
  date: string;
}
