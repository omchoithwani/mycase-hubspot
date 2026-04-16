import {
  ObjectType,
  SyncDirection,
  SyncJobPayload,
  SyncResult,
  ISyncProcessor,
} from '@mycase-hubspot/shared-types';

export abstract class BaseProcessor implements ISyncProcessor {
  abstract readonly objectType: ObjectType;
  abstract readonly direction: SyncDirection;

  canHandle(objectType: ObjectType, direction: SyncDirection): boolean {
    return this.objectType === objectType && this.direction === direction;
  }

  abstract process(
    payload: SyncJobPayload,
  ): Promise<SyncResult>;

  protected skip(reason: string): SyncResult {
    return { success: true, action: 'skipped', reason };
  }

  protected failed(errorCode: string, reason: string): SyncResult {
    return { success: false, action: 'failed', errorCode, reason };
  }
}
