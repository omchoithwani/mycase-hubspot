import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface SyncFilter {
  field: string;
  operator: string;
  value?: unknown;
}

export interface SyncFilterGroup {
  filters: SyncFilter[];
}

@Entity('sync_criteria')
export class SyncCriteria {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'object_type', type: 'varchar', length: 30 })
  objectType: string;

  @Column({ name: 'source_system', type: 'varchar', length: 10 })
  sourceSystem: string;

  @Column({ name: 'rule_name', type: 'varchar', length: 255, nullable: true })
  ruleName: string | null;

  @Column({ name: 'logic_operator', type: 'varchar', length: 5, default: 'AND' })
  logicOperator: string;

  /** Stores filter groups. OR between groups, AND within each group's filters. */
  @Column({ name: 'conditions', type: 'jsonb' })
  conditions: SyncFilterGroup[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
