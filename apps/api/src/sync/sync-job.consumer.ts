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
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS } from '../queue/queue.constants';
import { ContactToClientProcessor } from './processors/contact-to-client.processor';
import { ClientToContactProcessor } from './processors/client-to-contact.processor';
import { DealToMatterProcessor } from './processors/deal-to-matter.processor';
import { MatterToDealProcessor } from './processors/matter-to-deal.processor';
import { HsNoteToMcNoteProcessor } from './processors/hs-note-to-mc-note.processor';
import { McNoteToHsNoteProcessor } from './processors/mc-note-to-hs-note.processor';

/**
 * Processes jobs from BOTH sync queues.
 * Registered twice (once per queue name) via the @Processor decorator below.
 */

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
      `Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
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
      `Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
}

/**
 * The actual orchestration logic — shared between both consumers.
 *
 * Flow:
 *   1. Verify installation is active + MyCase connected
 *   2. Acquire Redis sync lock (loop detection)
 *   3. Route to the correct processor
 *   4. Write sync_job audit record
 *   5. Release lock
 */
@Injectable()
export class SyncOrchestrator {
  private readonly logger = new Logger(SyncOrchestrator.name);
  private readonly processors: ISyncProcessor[];

  constructor(
    private readonly installationService: InstallationService,
    private readonly lockService: SyncLockService,
    private readonly syncJobService: SyncJobService,
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

    this.logger.debug(
      `Processing job ${job.id}: ${direction} ${objectType}/${sourceId}`,
    );

    // 1. Check installation is active
    const installation = await this.installationService.findById(installationId);
    if (!installation) {
      const r = { success: false, action: 'skipped' as const, reason: 'Installation not found' };
      return r;
    }
    if (!installation.syncEnabled) {
      return { success: true, action: 'skipped', reason: 'Sync is disabled for this installation' };
    }
    if (!installation.mycaseConnected) {
      return { success: true, action: 'skipped', reason: 'MyCase not yet connected' };
    }

    // 2. Acquire sync lock — guards against loops and duplicate processing
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
      }
    } catch (err: any) {
      this.logger.error(
        `Processor threw for ${direction}/${objectType}/${sourceId}: ${err.message}`,
        err.stack,
      );
      await this.syncJobService.markFailed(dbJob.id, err.message);
      // Re-throw so BullMQ applies retry backoff
      throw err;
    } finally {
      await this.lockService.releaseLock(installationId, objectType as ObjectType, sourceId);
    }

    return result;
  }
}
