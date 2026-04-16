import { Module } from '@nestjs/common';
import { HubSpotClientService } from './hubspot-client.service';
import { HubSpotPropertiesService } from './hubspot-properties.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [AuthModule, InstallationModule],
  providers: [
    HubSpotRateLimiterService,
    HubSpotClientService,
    HubSpotPropertiesService,
  ],
  exports: [HubSpotClientService, HubSpotPropertiesService],
})
export class HubSpotModule {}
