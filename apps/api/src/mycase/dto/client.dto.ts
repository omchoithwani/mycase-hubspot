export interface McPhoneNumber {
  number: string;
  type?: string; // 'mobile' | 'home' | 'work'
}

export interface McClient {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone_numbers?: McPhoneNumber[];
  company_name?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export interface McClientInput {
  first_name: string;
  last_name: string;
  email?: string;
  phone_numbers?: McPhoneNumber[];
  company_name?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}
