export type ObjectType = 'contact' | 'deal' | 'note';
export type SyncDirection = 'hs_to_mc' | 'mc_to_hs';
export type SyncSystem = 'hubspot' | 'mycase';
export type SyncStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'skipped';

export interface SyncJobPayload {
  installationId: string;
  direction: SyncDirection;
  objectType: ObjectType;
  sourceId: string;
  sourceSystem: SyncSystem;
  triggeredBy: 'webhook' | 'poll' | 'manual';
  rawPayload?: Record<string, unknown>;
  attempt?: number;
  force?: boolean;
}

export interface FieldMismatch {
  field: string;
  droppedValue: unknown;
  reason: string;
}

export interface SyncResult {
  success: boolean;
  destinationId?: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  reason?: string;
  errorCode?: string;
  fieldMismatches?: FieldMismatch[];
  syncedData?: Record<string, unknown>;
}

export interface ISyncProcessor {
  process(payload: SyncJobPayload): Promise<SyncResult>;
  canHandle(objectType: ObjectType, direction: SyncDirection): boolean;
}

export enum SyncErrorCode {
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION = 'VALIDATION',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  NETWORK = 'NETWORK',
  DUPLICATE_AMBIGUOUS = 'DUPLICATE_AMBIGUOUS',
  MAPPING_MISSING = 'MAPPING_MISSING',
  STAGE_UNMAPPED = 'STAGE_UNMAPPED',
  MYCASE_API = 'MYCASE_API',
  HUBSPOT_API = 'HUBSPOT_API',
  INTERNAL = 'INTERNAL',
}
