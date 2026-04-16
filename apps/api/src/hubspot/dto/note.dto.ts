export interface HsNote {
  id: string;
  properties: {
    hs_note_body?: string;
    hs_timestamp?: string;
    hubspot_owner_id?: string;
    [key: string]: string | undefined;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface HsNoteInput {
  hs_note_body: string;
  hs_timestamp?: string;
  hubspot_owner_id?: string;
}

export interface HsNoteAssociation {
  to: { id: string };
  types: Array<{ associationCategory: string; associationTypeId: number }>;
}
