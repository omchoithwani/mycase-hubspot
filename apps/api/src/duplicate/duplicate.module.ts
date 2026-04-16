import { Module } from '@nestjs/common';
import { DuplicateDetectorService } from './duplicate-detector.service';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { MyCaseModule } from '../mycase/mycase.module';

@Module({
  imports: [HubSpotModule, MyCaseModule],
  providers: [DuplicateDetectorService],
  exports: [DuplicateDetectorService],
})
export class DuplicateModule {}
