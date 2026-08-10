import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { DataSource } from 'typeorm';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBoss;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    const dbUrl = config.getOrThrow<string>('DATABASE_URL');
    const sslDisabled = dbUrl.includes('sslmode=disable');
    this.boss = new PgBoss({
      connectionString: dbUrl,
      ssl: sslDisabled ? false : (config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false),
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

  async createQueue(name: string): Promise<void> {
    // Try pg-boss built-in createQueue first
    try {
      await this.boss.createQueue(name);
    } catch (err: any) {
      this.logger.warn(`pg-boss createQueue threw for "${name}": ${err.message}`);
    }

    // Verify the queue actually exists — pg-boss's createQueue can silently no-op
    // when its internal connection pool has issues with the Supabase session pooler.
    let rows: { name: string }[] = [];
    try {
      rows = await this.dataSource.query<{ name: string }[]>(
        'SELECT name FROM pgboss.queue WHERE name = $1',
        [name],
      );
    } catch (err: any) {
      if (err?.code === '42P01') {
        // pgboss schema not yet initialized (fresh DB) — boss.start() handles this
        this.logger.warn(`pgboss schema not found during queue verification for "${name}" — skipping fallback`);
        return;
      }
      throw err;
    }

    if (rows.length === 0) {
      this.logger.warn(
        `Queue "${name}" missing after boss.createQueue — creating via TypeORM DataSource`,
      );
      // Call the same pg-boss plpgsql function but via the TypeORM connection pool,
      // which uses a fresh connection not bound to pg-boss's internal pool state.
      await this.dataSource.query('SELECT pgboss.create_queue($1, $2::json)', [
        name,
        JSON.stringify({
          policy: 'standard',
          retryLimit: 2,
          retryDelay: 0,
          retryBackoff: false,
          expireInSeconds: 900,
          retentionMinutes: 20160,
        }),
      ]);
      this.logger.log(`Queue "${name}" created via TypeORM fallback`);
    } else {
      this.logger.log(`Queue "${name}" confirmed in pgboss.queue`);
    }
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
