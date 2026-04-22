import { Injectable, Logger } from '@nestjs/common';
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
import { SYNC_JOB_OPTIONS } from '../queue/queue.constants';
import { ContactToClientProcessor } from './processors/contact-to-client.processor';
import { ClientToContactProcessor } from './processors/client-to-contact.processor';
import { DealToMatterProcessor } from './processors/deal-to-matter.processor';
import { MatterToDealProcessor } from './processors/matter-to-deal.processor';
import { HsNoteToMcNoteProcessor } from './processors/hs-note-to-mc-note.processor';
import { McNoteToHsNoteProcessor } from './processors/mc-note-to-hs-note.processor';

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

    this.logger.log(
      `Processing job ${job.id}: ${direction} ${objectType}/${sourceId} (attempt ${payload.attempt}/${maxAttempts})`,
    );

    const installation = await this.installationService.findById(installationId);
    if (!installation) {
      this.logger.warn(`Job ${job.id}: installation ${installationId} not found — skipping`);
      return { success: false, action: 'skipped', reason: 'Installation not found' };
    }
    if (!installation.syncEnabled) {
      this.logger.log(`Job ${job.id}: sync disabled for installation ${installationId} — skipping`);
      return { success: true, action: 'skipped', reason: 'Sync is disabled for this installation' };
    }
    if (!installation.mycaseConnected) {
      this.logger.log(`Job ${job.id}: MyCase not connected for installation ${installationId} — skipping`);
      return { success: true, action: 'skipped', reason: 'MyCase not yet connected' };
    }

    const lockAcquired = await this.lockService.acquireLock(
      installationId,
      objectType as ObjectType,
      sourceId,
      direction as SyncDirection,
    );
    if (!lockAcquired) {
      this.logger.log(`Job ${job.id}: lock blocked ${direction} ${objectType}/${sourceId} — loop prevention`);
      return {
        success: true,
        action: 'skipped',
        reason: 'Sync lock held by another direction or worker (loop prevention)',
      };
    }

    const dbJob = await this.syncJobService.create(payload, String(job.id));

    let result: SyncResult;
    try {
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

      if (result.action === 'skipped') {
        await this.syncJobService.markSkipped(dbJob.id, result.reason ?? '');
      } else if (result.success) {
        await this.syncJobService.markSuccess(dbJob.id, result);
      } else {
        await this.syncJobService.markFailed(dbJob.id, result.reason ?? 'Unknown error');
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

      throw err;
    } finally {
      await this.lockService.releaseLock(installationId, objectType as ObjectType, sourceId);
    }

    return result;
  }
}
