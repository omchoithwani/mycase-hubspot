import { Injectable, Logger } from '@nestjs/common';
import { SyncDirection, ObjectType } from '@mycase-hubspot/shared-types';

const LOCK_TTL_MS = 30_000;

/**
 * In-memory distributed lock for sync loop prevention.
 * Safe for single-instance deployments (Fly.io single machine).
 *
 * Key: installationId:objectType:objectId
 * Value: { direction, expiresAt }
 *
 * Two-layer strategy:
 *   1. No lock → acquire and proceed.
 *   2. Same direction → duplicate worker; skip.
 *   3. Opposite direction → sync loop triggered by destination write; skip.
 */
@Injectable()
export class SyncLockService {
  private readonly logger = new Logger(SyncLockService.name);
  private readonly locks = new Map<string, { direction: string; expiresAt: number }>();

  private key(installationId: string, objectType: ObjectType, objectId: string): string {
    return `${installationId}:${objectType}:${objectId}`;
  }

  async acquireLock(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
    direction: SyncDirection,
    ttlMs: number = LOCK_TTL_MS,
  ): Promise<boolean> {
    const key = this.key(installationId, objectType, objectId);
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      if (existing.direction !== direction) {
        this.logger.debug(
          `Loop detected: ${objectType}/${objectId} locked by ${existing.direction}, current ${direction} — skipping`,
        );
      } else {
        this.logger.debug(
          `Duplicate job: ${objectType}/${objectId} already processing in ${direction}`,
        );
      }
      return false;
    }

    this.locks.set(key, { direction, expiresAt: now + ttlMs });
    this.logger.verbose(`Lock acquired: ${key} → ${direction}`);
    return true;
  }

  async releaseLock(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
  ): Promise<void> {
    const key = this.key(installationId, objectType, objectId);
    this.locks.delete(key);
    this.logger.verbose(`Lock released: ${key}`);
  }

  async isLocked(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
  ): Promise<string | null> {
    const key = this.key(installationId, objectType, objectId);
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.direction;
    return null;
  }
}
