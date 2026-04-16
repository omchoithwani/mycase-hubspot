import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Installation } from '@mycase-hubspot/db';
import { InstallationService } from './installation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Installation])],
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
