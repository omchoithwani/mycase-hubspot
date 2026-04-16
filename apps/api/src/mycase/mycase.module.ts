import { Module } from '@nestjs/common';
import { MyCaseClientService } from './mycase-client.service';
import { AuthModule } from '../auth/auth.module';
import { InstallationModule } from '../installation/installation.module';

@Module({
  imports: [AuthModule, InstallationModule],
  providers: [MyCaseClientService],
  exports: [MyCaseClientService],
})
export class MyCaseModule {}
