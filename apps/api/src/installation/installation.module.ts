import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Installation } from '@mycase-hubspot/db';
import { InstallationService } from './installation.service';
import { InstallationController } from './installation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Installation])],
  controllers: [InstallationController],
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
