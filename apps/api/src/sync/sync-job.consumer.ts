import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  SyncJobPayload,
  SyncResult,
  ObjectType,
  SyncDirection,
  ISyncProcessor,
} from '@mycase-hubspot/shared-types';
import { SyncLockService } from './sync-lock.service';
import { SyncJobService } from './sync-job.service';
import { InstallationService } from '../installation/installation.service';
import { ErrorLogService } from '../error-log/error-log.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTIONS } from '../queue/queue.constants';
import { ContactToClientProcessor } from './processors/contact-to-client.processor';
import { ClientToContactProcessor } from './processors/client-to-contact.processor';
import { DealToMatterProcessor } from './processors/deal-to-matter.processor';
import { MatterToDealProcessor } from './processors/matter-to-deal.processor';
import { HsNoteToMcNoteProcessor } from './processors/hs-note-to-mc-note.processor';
import { McNoteToHsNoteProcessor } from './processors/mc-note-to-hs-note.processor';

@Injectable()
@Processor(QUEUE_HS_TO_MC)
export class SyncHsToMcConsumer extends WorkerHost {
  private readonly logger = new Logger('SyncHsToMcConsumer');

  constructor(private readonly orchestrator: SyncOrchestrator) {
    super();
  }

  async process(job: Job<SyncJobPayload>): Promise<SyncResult> {
    return this.orchestrator.handle(job);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SyncJobPayload>, error: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? SYNC_JOB_OPTIONS.attempts}): ${error.message}`,
    );
  }
}

@Injectable()
@Processor(QUEUE_MC_TO_HS)
export class SyncMcToHsConsumer extends WorkerHost {
  private readonly logger = new Logger('SyncMcToHsConsumer');

  constructor(private readonly orchestrator: SyncOrchestrator) {
    super();
  }

  async process(job: Job<SyncJobPayload>): Promise<SyncResult> {
    return this.orchestrator.handle(job);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SyncJobPayload>, error: Error) {
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? SYNC_JOB_OPTIONS.attempts}): ${error.message}`,
    );
  }
}

/**
 * Shared orchestration logic — handles both sync queues.
 *
 * Flow:
 *   1. Verify installation active + MyCase connected
 *   2. Acquire Redis sync lock (loop detection)
 *   3. Route to the correct processor
 *   4. Write sync_job audit record
 *   5. On permanent failure → write to error_logs
 *   6. Release lock
 */
@Injectable()
export class SyncOrchestrator {
  private readonly logger = new Logger(SyncOrchestrator.name);
  private readonly processors: ISyncProcessor[];

  constructor(
    private readonly installationService: InstallationService,
    private readonly lockService: SyncLockService,
    private readonly syncJobService: SyncJobService,
    private readonly errorLogService: ErrorLogService,
    contactToClient: ContactToClientProcessor,
    clientToContact: ClientToContactProcessor,
    dealToMatter: DealToMatterProcessor,
    matterToDeal: MatterToDealProcessor,
    hsNoteToMcNote: HsNoteToMcNoteProcessor,
    mcNoteToHsNote: McNoteToHsNoteProcessor,
  ) {
    this.processors = [
      contactToClient,
      clientToContact,
      dealToMatter,
      matterToDeal,
      hsNoteToMcNote,
      mcNoteToHsNote,
    ];
  }

  async handle(job: Job<SyncJobPayload>): Promise<SyncResult> {
    const payload = job.data;
    const { installationId, objectType, direction, sourceId } = payload;
    payload.attempt = job.attemptsMade + 1;

    const maxAttempts = job.opts.attempts ?? SYNC_JOB_OPTIONS.attempts;
    const isFinalAttempt = payload.attempt >= maxAttempts;

    this.logger.debug(
      `Processing job ${job.id}: ${direction} ${objectType}/${sourceId} (attempt ${payload.attempt}/${maxAttempts})`,
    );

    // 1. Check installation is active
    const installation = await this.installationService.findById(installationId);
    if (!installation) {
      return { success: false, action: 'skipped', reason: 'Installation not found' };
    }
    if (!installation.syncEnabled) {
      return { success: true, action: 'skipped', reason: 'Sync is disabled for this installation' };
    }
    if (!installation.mycaseConnected) {
      return { success: true, action: 'skipped', reason: 'MyCase not yet connected' };
    }

    // 2. Acquire sync lock
    const lockAcquired = await this.lockService.acquireLock(
      installationId,
      objectType as ObjectType,
      sourceId,
      direction as SyncDirection,
    );
    if (!lockAcquired) {
      return {
        success: true,
        action: 'skipped',
        reason: 'Sync lock held by another direction or worker (loop prevention)',
      };
    }

    // 3. Write audit record
    const dbJob = await this.syncJobService.create(payload, String(job.id));

    let result: SyncResult;
    try {
      // 4. Find and run the correct processor
      const processor = this.processors.find((p) =>
        p.canHandle(objectType as ObjectType, direction as SyncDirection),
      );

      if (!processor) {
        const reason = `No processor found for ${direction}/${objectType}`;
        this.logger.error(reason);
        result = { success: false, action: 'failed', reason };
      } else {
        result = await processor.process(payload);
      }

      // 5. Write outcome to DB
      if (result.action === 'skipped') {
        await this.syncJobService.markSkipped(dbJob.id, result.reason ?? '');
      } else if (result.success) {
        await this.syncJobService.markSuccess(dbJob.id, result);
      } else {
        await this.syncJobService.markFailed(dbJob.id, result.reason ?? 'Unknown error');
        // Processor returned failed (no exception thrown) — always log to error_logs
        await this.errorLogService.log({
          installationId,
          syncJobId: dbJob.id,
          objectType,
          direction,
          sourceId,
          errorCode: result.errorCode ?? 'PROCESSOR_FAILED',
          errorMessage: result.reason ?? 'Unknown error',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Processor threw for ${direction}/${objectType}/${sourceId}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.syncJobService.markFailed(dbJob.id, msg);

      // Write to error_logs only on final attempt to avoid noise
      if (isFinalAttempt) {
        await this.errorLogService.log({
          installationId,
          syncJobId: dbJob.id,
          objectType,
          direction,
          sourceId,
          errorCode: 'EXCEPTION',
          errorMessage: msg,
        });
      }

      throw err; // re-throw for BullMQ retry backoff
    } finally {
      await this.lockService.releaseLock(installationId, objectType as ObjectType, sourceId);
    }

    return result;
  }
}
