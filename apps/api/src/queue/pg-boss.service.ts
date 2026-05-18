import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBoss;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      ssl: config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      // Poll every 5s instead of default 2s to reduce Neon serverless connection overhead
      pollingIntervalSeconds: 5,
    });
    this.boss.on('error', (err: Error) =>
      this.logger.error(`pg-boss error: ${err.message}`, err.stack),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    this.logger.log('pg-boss started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.logger.log('pg-boss stopped');
  }

  async send(
    queue: string,
    data: object,
    opts: PgBoss.SendOptions = {},
  ): Promise<string | null> {
    return this.boss.send(queue, data, opts);
  }

  async insert(jobs: PgBoss.JobInsert[]): Promise<void> {
    await this.boss.insert(jobs);
  }

  /**
   * Register a worker. includeMetadata is always true so handlers can access
   * retryCount. The internal array iteration is handled here; callers receive
   * a single JobWithMetadata per invocation.
   */
  async work<T extends object>(
    queue: string,
    handler: (job: PgBoss.JobWithMetadata<T>) => Promise<void>,
    opts: PgBoss.WorkOptions = {},
  ): Promise<string> {
    return this.boss.work<T>(
      queue,
      { ...opts, includeMetadata: true },
      async (jobs: PgBoss.JobWithMetadata<T>[]) => {
        for (const job of jobs) {
          await handler(job);
        }
      },
    );
  }
}
