import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { MyCaseClientService } from './mycase-client.service';
import { MyCaseWebhookController } from './mycase-webhook.controller';
import { MyCasePollerService } from './mycase-poller.service';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PollingCursor]),
    forwardRef(() => AuthModule),
    InstallationModule,
  ],
  controllers: [MyCaseWebhookController],
  providers: [MyCaseClientService, MyCasePollerService],
  exports: [MyCaseClientService],
})
export class MyCaseModule {}
