import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SyncRecord, SyncJob, PollingCursor } from '@mycase-hubspot/db';
import { SyncLockService } from './sync-lock.service';
import { SyncRecordService } from './sync-record.service';
import { SyncJobService } from './sync-job.service';
import { SyncOrchestrator } from './sync-orchestrator.service';
import { SyncHsToMcConsumer, SyncMcToHsConsumer } from './sync-job.consumer';
import { ContactToClientProcessor } from './processors/contact-to-client.processor';
import { ClientToContactProcessor } from './processors/client-to-contact.processor';
import { DealToMatterProcessor } from './processors/deal-to-matter.processor';
import { MatterToDealProcessor } from './processors/matter-to-deal.processor';
import { HsNoteToMcNoteProcessor } from './processors/hs-note-to-mc-note.processor';
import { McNoteToHsNoteProcessor } from './processors/mc-note-to-hs-note.processor';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { MyCaseModule } from '../mycase/mycase.module';
import { InstallationModule } from '../installation/installation.module';
import { FieldMappingModule } from '../field-mapping/field-mapping.module';
import { StageMappingModule } from '../stage-mapping/stage-mapping.module';
import { DuplicateModule } from '../duplicate/duplicate.module';
import { SyncCriteriaModule } from '../sync-criteria/sync-criteria.module';
import { ErrorLogModule } from '../error-log/error-log.module';
import { SyncJobController } from './sync-job.controller';
import { InitialSyncService } from './initial-sync.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS } from '../queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncRecord, SyncJob, PollingCursor]),
    BullModule.registerQueue(
      { name: QUEUE_HS_TO_MC },
      { name: QUEUE_MC_TO_HS },
    ),
    HubSpotModule,
    MyCaseModule,
    InstallationModule,
    FieldMappingModule,
    StageMappingModule,
    DuplicateModule,
    SyncCriteriaModule,
    ErrorLogModule,
  ],
  controllers: [SyncJobController],
  providers: [
    SyncLockService,
    SyncRecordService,
    SyncJobService,
    // Processors
    ContactToClientProcessor,
    ClientToContactProcessor,
    DealToMatterProcessor,
    MatterToDealProcessor,
    HsNoteToMcNoteProcessor,
    McNoteToHsNoteProcessor,
    // Orchestrator + consumers
    SyncOrchestrator,
    SyncHsToMcConsumer,
    SyncMcToHsConsumer,
    InitialSyncService,
  ],
  exports: [SyncRecordService, SyncJobService, InitialSyncService],
})
export class SyncModule {}
