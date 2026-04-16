import { Controller, Get, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [db, redisOk] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const allOk = db && redisOk;
    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: db ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
