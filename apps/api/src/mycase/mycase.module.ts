import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { PollingCursor } from '@mycase-hubspot/db';
import { MyCaseClientService } from './mycase-client.service';
import { MyCaseWebhookController } from './mycase-webhook.controller';
import { MyCasePollerService } from './mycase-poller.service';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';
import { QUEUE_MC_TO_HS } from '../queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([PollingCursor]),
    BullModule.registerQueue({ name: QUEUE_MC_TO_HS }),
    forwardRef(() => AuthModule),
    InstallationModule,
  ],
  controllers: [MyCaseWebhookController],
  providers: [MyCaseClientService, MyCasePollerService],
  exports: [MyCaseClientService],
})
export class MyCaseModule {}
