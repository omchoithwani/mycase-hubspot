import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { HubSpotOAuthService } from './hubspot-oauth.service';
import { MyCaseOAuthService } from './mycase-oauth.service';
import { TokenStoreService } from './token-store.service';
import { InstallationModule } from '../installation/installation.module';
import { HubSpotModule } from '../hubspot/hubspot.module';
import { MyCaseModule } from '../mycase/mycase.module';
import { FieldMappingModule } from '../field-mapping/field-mapping.module';
import { StageMappingModule } from '../stage-mapping/stage-mapping.module';

@Module({
  imports: [
    InstallationModule,
    forwardRef(() => HubSpotModule),
    forwardRef(() => MyCaseModule),
    FieldMappingModule,
    StageMappingModule,
  ],
  controllers: [AuthController],
  providers: [HubSpotOAuthService, MyCaseOAuthService, TokenStoreService],
  exports: [HubSpotOAuthService, MyCaseOAuthService, TokenStoreService],
})
export class AuthModule {}
