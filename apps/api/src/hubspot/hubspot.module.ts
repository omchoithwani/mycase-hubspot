import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HubSpotClientService } from './hubspot-client.service';
import { HubSpotPropertiesService } from './hubspot-properties.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { HubSpotWebhookController } from './hubspot-webhook.controller';
import { HubSpotHmacGuard } from '../common/guards/hmac.guard';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';
import { QUEUE_HS_TO_MC } from '../queue/queue.constants';

@Module({
  imports: [
    AuthModule,
    InstallationModule,
    BullModule.registerQueue({ name: QUEUE_HS_TO_MC }),
  ],
  controllers: [HubSpotWebhookController],
  providers: [
    HubSpotRateLimiterService,
    HubSpotClientService,
    HubSpotPropertiesService,
    HubSpotHmacGuard,
  ],
  exports: [HubSpotClientService, HubSpotPropertiesService],
})
export class HubSpotModule {}
