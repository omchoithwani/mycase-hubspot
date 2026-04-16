import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { SyncRecord } from '@mycase-hubspot/db';
import { ObjectType } from '@mycase-hubspot/shared-types';

@Injectable()
export class SyncRecordService {
  constructor(
    @InjectRepository(SyncRecord)
    private readonly repo: Repository<SyncRecord>,
  ) {}

  async findByHubSpotId(
    installationId: string,
    objectType: ObjectType,
    hubspotObjectId: string,
  ): Promise<SyncRecord | null> {
    return this.repo.findOne({
      where: { installationId, objectType, hubspotObjectId },
    });
  }

  async findByMyCaseId(
    installationId: string,
    objectType: ObjectType,
    mycaseObjectId: string,
  ): Promise<SyncRecord | null> {
    return this.repo.findOne({
      where: { installationId, objectType, mycaseObjectId },
    });
  }

  async upsert(params: {
    installationId: string;
    objectType: ObjectType;
    hubspotObjectId: string;
    mycaseObjectId: string;
    payload: Record<string, unknown>;
    direction?: string;
  }): Promise<SyncRecord> {
    const hash = this.hashPayload(params.payload);
    const now = new Date();

    let record = await this.findByHubSpotId(
      params.installationId,
      params.objectType,
      params.hubspotObjectId,
    );

    if (!record) {
      record = this.repo.create({
        installationId: params.installationId,
        objectType: params.objectType,
        hubspotObjectId: params.hubspotObjectId,
        mycaseObjectId: params.mycaseObjectId,
        lastSyncedAt: now,
        lastSyncedHash: hash,
        syncDirection: params.direction ?? 'both',
      });
    } else {
      record.mycaseObjectId = params.mycaseObjectId;
      record.lastSyncedAt = now;
      record.lastSyncedHash = hash;
    }

    return this.repo.save(record);
  }

  /**
   * Returns true if the payload hash matches the last synced hash.
   * Used to skip no-op updates (change detection, loop prevention layer 2).
   */
  isSamePayload(record: SyncRecord, payload: Record<string, unknown>): boolean {
    return record.lastSyncedHash === this.hashPayload(payload);
  }

  hashPayload(payload: Record<string, unknown>): string {
    // Sort keys for deterministic hashing
    const sorted = Object.fromEntries(
      Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
    );
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }
}
