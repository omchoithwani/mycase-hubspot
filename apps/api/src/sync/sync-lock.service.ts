import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { SyncDirection, ObjectType } from '@mycase-hubspot/shared-types';

const LOCK_TTL_MS = 30_000;

/**
 * Redis-backed distributed lock for sync loop prevention.
 *
 * Key format:  sync:lock:{installationId}:{objectType}:{objectId}
 * Value:       direction ('hs_to_mc' | 'mc_to_hs')
 *
 * Two-layer strategy:
 *   1. If no lock exists → set and proceed.
 *   2. If a lock for the SAME direction exists → another worker is
 *      already processing this record; skip (deduplication).
 *   3. If a lock for the OPPOSITE direction exists → this is a sync
 *      loop triggered by the destination writing back; skip.
 */

const LOCK_KEY = (
  installationId: string,
  objectType: ObjectType,
  objectId: string,
) => `sync:lock:${installationId}:${objectType}:${objectId}`;

/** Lua: SET NX PX — returns 1 if acquired, 0 if already held */
const ACQUIRE_SCRIPT = `
local key   = KEYS[1]
local value = ARGV[1]
local ttl   = tonumber(ARGV[2])
local existing = redis.call('GET', key)
if existing == false then
  redis.call('SET', key, value, 'PX', ttl)
  return 1
end
return 0
`;

@Injectable()
export class SyncLockService {
  private readonly logger = new Logger(SyncLockService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Attempt to acquire a sync lock.
   * Returns true if the lock was acquired, false if another lock exists
   * (same or opposite direction — caller should skip the job).
   */
  async acquireLock(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
    direction: SyncDirection,
    ttlMs: number = LOCK_TTL_MS,
  ): Promise<boolean> {
    const key = LOCK_KEY(installationId, objectType, objectId);

    // Check current holder first (cheap GET before the Lua eval)
    const existing = await this.redis.get(key);
    if (existing !== null) {
      if (existing !== direction) {
        this.logger.debug(
          `Loop detected: ${objectType}/${objectId} locked by ${existing}, current direction ${direction} — skipping`,
        );
      } else {
        this.logger.debug(
          `Duplicate job: ${objectType}/${objectId} already processing in ${direction}`,
        );
      }
      return false;
    }

    const acquired = await (this.redis as any).eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      direction,
      ttlMs,
    ) as number;

    if (acquired === 1) {
      this.logger.verbose(`Lock acquired: ${key} → ${direction}`);
      return true;
    }

    return false;
  }

  async releaseLock(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
  ): Promise<void> {
    const key = LOCK_KEY(installationId, objectType, objectId);
    await this.redis.del(key);
    this.logger.verbose(`Lock released: ${key}`);
  }

  async isLocked(
    installationId: string,
    objectType: ObjectType,
    objectId: string,
  ): Promise<string | null> {
    return this.redis.get(LOCK_KEY(installationId, objectType, objectId));
  }
}
