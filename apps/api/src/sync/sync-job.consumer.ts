import { Injectable, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS } from '../queue/queue.constants';
import { SyncOrchestrator } from './sync-orchestrator.service';

@Injectable()
export class SyncJobConsumer implements OnModuleInit {
  constructor(
    private readonly pgBoss: PgBossService,
    private readonly orchestrator: SyncOrchestrator,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.pgBoss.work<SyncJobPayload>(QUEUE_HS_TO_MC, async (job) => {
      await this.orchestrator.handle(job);
    });
    await this.pgBoss.work<SyncJobPayload>(QUEUE_MC_TO_HS, async (job) => {
      await this.orchestrator.handle(job);
    });
  }
}
