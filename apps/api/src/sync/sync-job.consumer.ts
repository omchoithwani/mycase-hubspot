import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTIONS } from '../queue/queue.constants';
import { SyncOrchestrator } from './sync-orchestrator.service';

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
