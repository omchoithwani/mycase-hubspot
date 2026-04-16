export interface HsContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    lifecyclestage?: string;
    mycase_client_id?: string;
    [key: string]: string | undefined;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface HsContactInput {
  email?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  mycase_client_id?: string;
  [key: string]: string | undefined;
}
