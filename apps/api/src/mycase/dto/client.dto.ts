export interface McClient {
  id: string | number;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email?: string;
  cell_phone_number?: string;
  work_phone_number?: string;
  home_phone_number?: string;
  fax_phone_number?: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
  };
  notes?: string;
  birthdate?: string;
  archived?: boolean;
  cases?: Array<{ id: number }>;
  created_at?: string;
  updated_at?: string;
}

export interface McClientInput {
  first_name: string;
  last_name: string;
  middle_name?: string;
  email?: string;
  cell_phone_number?: string;
  work_phone_number?: string;
  home_phone_number?: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
  };
  notes?: string;
  birthdate?: string;
  cases?: Array<{ id: number }>;
}
