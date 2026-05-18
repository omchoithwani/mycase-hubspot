import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { HubSpotClientService } from './hubspot-client.service';
import { HubSpotPropertiesService } from './hubspot-properties.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { HubSpotWebhookController } from './hubspot-webhook.controller';
import { HubSpotPollerService } from './hubspot-poller.service';
import { HubSpotHmacGuard } from '../common/guards/hmac.guard';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PollingCursor]),
    forwardRef(() => AuthModule),
    InstallationModule,
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
