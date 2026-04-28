export interface HsDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    closedate?: string;
    dealstage?: string;
    pipeline?: string;
    my_case_id?: string;
    [key: string]: string | undefined;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface HsDealInput {
  dealname?: string;
  amount?: string;
  closedate?: string;
  dealstage?: string;
  pipeline?: string;
  my_case_id?: string;
  [key: string]: string | undefined;
}

export interface HsPipeline {
  id: string;
  label: string;
  stages: HsPipelineStage[];
}

export interface HsPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { isClosed?: string; probability?: string };
}
