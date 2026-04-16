import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('field_mappings')
@Unique(['installationId', 'objectType', 'hubspotField', 'mycaseField'])
export class FieldMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'object_type', type: 'varchar', length: 30 })
  objectType: string;

  @Column({ name: 'hubspot_field', type: 'varchar', length: 255 })
  hubspotField: string;

  @Column({ name: 'mycase_field', type: 'varchar', length: 255 })
  mycaseField: string;

  @Column({ name: 'direction', type: 'varchar', length: 10, default: 'both' })
  direction: string;

  @Column({ name: 'transform_type', type: 'varchar', length: 50, default: 'direct' })
  transformType: string;

  @Column({ name: 'transform_config', type: 'jsonb', nullable: true })
  transformConfig: Record<string, unknown> | null;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
