import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldMapping } from '@mycase-hubspot/db';
import { FieldMappingService } from './field-mapping.service';
import { FieldTransformerService } from './field-transformer.service';
import { FieldMappingController } from './field-mapping.controller';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FieldMapping]),
    HubSpotModule,
    InstallationModule,
  ],
  controllers: [FieldMappingController],
  providers: [FieldMappingService, FieldTransformerService],
  exports: [FieldMappingService, FieldTransformerService],
})
export class FieldMappingModule {}
