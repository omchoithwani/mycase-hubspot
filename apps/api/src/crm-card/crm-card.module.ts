import { Module } from '@nestjs/common';
import { CrmCardController } from './crm-card.controller';
import { InstallationModule } from '../installation/installation.module';
import { SyncModule } from '../sync/sync.module';
import { MyCaseModule } from '../mycase/mycase.module';
import { ErrorLogModule } from '../error-log/error-log.module';

@Module({
  imports: [InstallationModule, SyncModule, MyCaseModule, ErrorLogModule],
  controllers: [CrmCardController],
})
export class CrmCardModule {}
