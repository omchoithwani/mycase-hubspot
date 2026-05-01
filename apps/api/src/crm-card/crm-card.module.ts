import { Module } from '@nestjs/common';
import { CrmCardController } from './crm-card.controller';
import { InstallationModule } from '../installation/installation.module';
import { SyncModule } from '../sync/sync.module';
import { MyCaseModule } from '../mycase/mycase.module';

@Module({
  imports: [InstallationModule, SyncModule, MyCaseModule],
  controllers: [CrmCardController],
})
export class CrmCardModule {}
