import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('polling_cursors')
@Unique(['installationId', 'objectType'])
export class PollingCursor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'object_type', type: 'varchar', length: 30 })
  objectType: string;

  @Column({ name: 'last_polled_at', type: 'timestamptz', default: () => 'NOW()' })
  lastPolledAt: Date;

  @Column({ name: 'last_cursor', type: 'varchar', length: 255, nullable: true })
  lastCursor: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
