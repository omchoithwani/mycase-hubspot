export const QUEUE_HS_TO_MC = 'sync-hs-to-mc';
export const QUEUE_MC_TO_HS = 'sync-mc-to-hs';

/** pg-boss job options applied to every sync job: 5 total attempts with exponential backoff */
export const SYNC_JOB_OPTS = {
  retryLimit: 4,      // 4 retries + 1 initial = 5 total attempts
  retryDelay: 5,      // 5s base delay → 10s → 20s → 40s
  retryBackoff: true, // exponential
} as const;

export const SYNC_JOB_MAX_ATTEMPTS = SYNC_JOB_OPTS.retryLimit + 1; // 5
