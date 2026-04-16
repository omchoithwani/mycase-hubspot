import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, QUEUE_DLQ } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.getOrThrow<string>('REDIS_URL');
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            password: url.password || undefined,
            tls: url.protocol === 'rediss:' ? {} : undefined,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_HS_TO_MC },
      { name: QUEUE_MC_TO_HS },
      { name: QUEUE_DLQ },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
