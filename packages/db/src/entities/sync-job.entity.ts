import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('sync_jobs')
@Index(['installationId', 'createdAt'])
@Index(['installationId', 'objectType', 'status'])
export class SyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'bull_job_id', type: 'varchar', length: 100, nullable: true })
  bullJobId: string | null;

  @Column({ name: 'object_type', type: 'varchar', length: 30 })
  objectType: string;

  @Column({ name: 'direction', type: 'varchar', length: 10 })
  direction: string;

  @Column({ name: 'source_id', type: 'varchar', length: 100 })
  sourceId: string;

  @Column({ name: 'destination_id', type: 'varchar', length: 100, nullable: true })
  destinationId: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 1 })
  attemptCount: number;

  @Column({ name: 'payload_snapshot', type: 'jsonb', nullable: true })
  payloadSnapshot: Record<string, unknown> | null;

  @Column({ name: 'changed_fields', type: 'jsonb', nullable: true })
  changedFields: string[] | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
