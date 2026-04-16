import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('sync_records')
@Unique(['installationId', 'objectType', 'hubspotObjectId'])
@Unique(['installationId', 'objectType', 'mycaseObjectId'])
@Index(['installationId', 'objectType'])
export class SyncRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'object_type', type: 'varchar', length: 30 })
  objectType: string;

  @Column({ name: 'hubspot_object_id', type: 'varchar', length: 100 })
  hubspotObjectId: string;

  @Column({ name: 'mycase_object_id', type: 'varchar', length: 100 })
  mycaseObjectId: string;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_synced_hash', type: 'varchar', length: 64, nullable: true })
  lastSyncedHash: string | null;

  @Column({ name: 'sync_direction', type: 'varchar', length: 10, default: 'both' })
  syncDirection: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
