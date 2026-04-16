export const QUEUE_HS_TO_MC = 'sync-hs-to-mc';
export const QUEUE_MC_TO_HS = 'sync-mc-to-hs';
export const QUEUE_DLQ = 'sync-dlq';

/** BullMQ job options applied to every sync job */
export const SYNC_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 5_000, // 5s → 10s → 20s → 40s → 80s
  },
  removeOnComplete: { count: 1_000 },
  removeOnFail: false, // keep in queue for DLQ inspection
};
