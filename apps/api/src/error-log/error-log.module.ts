import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ErrorLog } from '@mycase-hubspot/db';
import { ErrorLogService } from './error-log.service';
import { ErrorLogController } from './error-log.controller';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS } from '../queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ErrorLog]),
    BullModule.registerQueue(
      { name: QUEUE_HS_TO_MC },
      { name: QUEUE_MC_TO_HS },
    ),
  ],
  controllers: [ErrorLogController],
  providers: [ErrorLogService],
  exports: [ErrorLogService],
})
export class ErrorLogModule {}
