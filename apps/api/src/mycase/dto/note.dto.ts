export interface McNote {
  id: string;
  description: string;
  date?: string;       // ISO date string
  client_id?: string;
  matter_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface McNoteInput {
  description: string;
  date?: string;
  client_id?: string;
  matter_id?: string;
}
