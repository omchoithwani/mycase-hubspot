export type TransformType =
  | 'direct'
  | 'date_format'
  | 'currency_cents'
  | 'boolean_string'
  | 'select_remap'
  | 'phone_format'
  | 'truncate'
  | 'html_strip';

export interface FieldMappingConfig {
  objectType: 'contact' | 'deal' | 'note';
  hubspotField: string;
  mycaseField: string;
  direction: 'both' | 'hs_to_mc' | 'mc_to_hs';
  transformType: TransformType;
  transformConfig?: Record<string, unknown>;
}

export const DEFAULT_FIELD_MAPPINGS: FieldMappingConfig[] = [
  {
    objectType: 'contact',
    hubspotField: 'email',
    mycaseField: 'email',
    direction: 'both',
    transformType: 'direct',
  },
  {
    objectType: 'contact',
    hubspotField: 'firstname',
    mycaseField: 'first_name',
    direction: 'both',
    transformType: 'direct',
  },
  {
    objectType: 'contact',
    hubspotField: 'lastname',
    mycaseField: 'last_name',
    direction: 'both',
    transformType: 'direct',
  },
  {
    objectType: 'contact',
    hubspotField: 'phone',
    mycaseField: 'cell_phone_number',
    direction: 'both',
    transformType: 'phone_format',
  },
  {
    objectType: 'deal',
    hubspotField: 'dealname',
    mycaseField: 'name',
    direction: 'both',
    transformType: 'direct',
  },
  {
    objectType: 'deal',
    hubspotField: 'amount',
    mycaseField: 'outstanding_balance',
    direction: 'both',
    transformType: 'direct',
  },
  {
    objectType: 'deal',
    hubspotField: 'closedate',
    mycaseField: 'sol_date',
    direction: 'both',
    transformType: 'date_format',
  },
  {
    objectType: 'note',
    hubspotField: 'hs_note_body',
    mycaseField: 'note',
    direction: 'both',
    transformType: 'html_strip',
  },
];
