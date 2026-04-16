import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis-backed token bucket for HubSpot's marketplace rate limit:
 * 110 requests per 10 seconds (rolling window).
 *
 * Uses a Lua script for atomic read-and-decrement so multiple workers
 * (e.g. BullMQ consumers) share a single bucket without race conditions.
 */

const BUCKET_KEY = (portalId: string) => `hs:ratelimit:${portalId}`;
const CAPACITY = 110;
const WINDOW_MS = 10_000;

/**
 * Lua script: atomically check and decrement the bucket.
 * Returns the current token count BEFORE decrement, or -1 if empty.
 */
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

-- Remove tokens older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

local count = redis.call('ZCARD', key)
if count < capacity then
  redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
  redis.call('PEXPIRE', key, window)
  return capacity - count - 1
else
  return -1
end
`;

@Injectable()
export class HubSpotRateLimiterService {
  private readonly logger = new Logger(HubSpotRateLimiterService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Acquire a token for the given portal. Waits with exponential backoff
   * if the bucket is empty, up to maxWaitMs total.
   */
  async acquire(portalId: string, maxWaitMs = 30_000): Promise<void> {
    const key = BUCKET_KEY(portalId);
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      const remaining = await (this.redis as any).eval(
        ACQUIRE_SCRIPT,
        1,
        key,
        CAPACITY,
        Date.now(),
        WINDOW_MS,
      ) as number;

      if (remaining >= 0) {
        return; // token acquired
      }

      // Bucket full — back off and retry
      attempt++;
      const delay = Math.min(200 * attempt, 2_000);
      this.logger.verbose(
        `Rate limit bucket full for portal ${portalId}, waiting ${delay}ms (attempt ${attempt})`,
      );
      await this.sleep(delay);
    }

    throw new Error(
      `HubSpot rate limit: could not acquire token for portal ${portalId} within ${maxWaitMs}ms`,
    );
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
