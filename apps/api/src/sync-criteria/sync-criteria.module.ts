import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncCriteria } from '@mycase-hubspot/db';
import { CriteriaEvaluatorService } from './criteria-evaluator.service';
import { SyncCriteriaService } from './sync-criteria.service';
import { SyncCriteriaController } from './sync-criteria.controller';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { InstallationModule } from '../installation/installation.module';
import { MyCaseModule } from '../mycase/mycase.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncCriteria]),
    HubSpotModule,
    InstallationModule,
    MyCaseModule,
  ],
  controllers: [SyncCriteriaController],
  providers: [CriteriaEvaluatorService, SyncCriteriaService],
  exports: [SyncCriteriaService],
})
export class SyncCriteriaModule {}
