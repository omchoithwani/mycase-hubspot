import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Installation } from './entities/installation.entity';
import { SyncRecord } from './entities/sync-record.entity';
import { FieldMapping } from './entities/field-mapping.entity';
import { StageMapping } from './entities/stage-mapping.entity';
import { SyncCriteria } from './entities/sync-criteria.entity';
import { SyncJob } from './entities/sync-job.entity';
import { ErrorLog } from './entities/error-log.entity';
import { PollingCursor } from './entities/polling-cursor.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  entities: [
    Installation,
    SyncRecord,
    FieldMapping,
    StageMapping,
    SyncCriteria,
    SyncJob,
    ErrorLog,
    PollingCursor,
  ],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
});
