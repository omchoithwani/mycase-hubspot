import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory token bucket for HubSpot's marketplace rate limit:
 * 110 requests per 10 seconds (rolling window).
 *
 * Safe for single-instance deployments (Fly.io single machine).
 */

const CAPACITY = 110;
const WINDOW_MS = 10_000;

@Injectable()
export class HubSpotRateLimiterService {
  private readonly logger = new Logger(HubSpotRateLimiterService.name);
  private readonly windows = new Map<string, number[]>();

  async acquire(portalId: string, maxWaitMs = 30_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const now = Date.now();
      if (!this.windows.has(portalId)) this.windows.set(portalId, []);
      const ts = this.windows.get(portalId)!;

      // Drop timestamps outside the rolling window
      const cutoff = now - WINDOW_MS;
      while (ts.length > 0 && ts[0] <= cutoff) ts.shift();

      if (ts.length < CAPACITY) {
        ts.push(now);
        return;
      }

      // Wait until the oldest entry rolls out of the window
      const waitMs = Math.min(ts[0] + WINDOW_MS - now + 1, 500);
      this.logger.verbose(
        `Rate limit bucket full for portal ${portalId}, waiting ${waitMs}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }

    throw new Error(
      `HubSpot rate limit: could not acquire token for portal ${portalId} within ${maxWaitMs}ms`,
    );
  }
}
