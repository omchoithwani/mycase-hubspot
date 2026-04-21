import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { PollingCursor } from '@mycase-hubspot/db';
import { HubSpotClientService } from './hubspot-client.service';
import { HubSpotPropertiesService } from './hubspot-properties.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { HubSpotWebhookController } from './hubspot-webhook.controller';
import { HubSpotPollerService } from './hubspot-poller.service';
import { HubSpotHmacGuard } from '../common/guards/hmac.guard';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';
import { QUEUE_HS_TO_MC } from '../queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([PollingCursor]),
    forwardRef(() => AuthModule),
    InstallationModule,
    BullModule.registerQueue({ name: QUEUE_HS_TO_MC }),
  ],
  controllers: [HubSpotWebhookController],
  providers: [
    HubSpotRateLimiterService,
    HubSpotClientService,
    HubSpotPropertiesService,
    HubSpotHmacGuard,
    HubSpotPollerService,
  ],
  exports: [HubSpotClientService, HubSpotPropertiesService],
})
export class HubSpotModule {}
