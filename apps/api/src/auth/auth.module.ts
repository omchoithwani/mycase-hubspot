import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { HubSpotOAuthService } from './hubspot-oauth.service';
import { MyCaseOAuthService } from './mycase-oauth.service';
import { TokenStoreService } from './token-store.service';
import { InstallationModule } from '../installation/installation.module';
import { RedisModule } from '../common/redis.module';

@Module({
  imports: [InstallationModule, RedisModule],
  controllers: [AuthController],
  providers: [HubSpotOAuthService, MyCaseOAuthService, TokenStoreService],
  exports: [HubSpotOAuthService, MyCaseOAuthService, TokenStoreService],
})
export class AuthModule {}
