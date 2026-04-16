import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StageMapping } from '@mycase-hubspot/db';
import { StageMappingService } from './stage-mapping.service';
import { StageMappingController } from './stage-mapping.controller';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StageMapping]),
    HubSpotModule,
    InstallationModule,
  ],
  controllers: [StageMappingController],
  providers: [StageMappingService],
  exports: [StageMappingService],
})
export class StageMappingModule {}
