import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

@Entity('stage_mappings')
@Unique(['installationId', 'hubspotPipelineId', 'hubspotStageId'])
export class StageMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'hubspot_pipeline_id', type: 'varchar', length: 100 })
  hubspotPipelineId: string;

  @Column({ name: 'hubspot_stage_id', type: 'varchar', length: 100 })
  hubspotStageId: string;

  @Column({ name: 'hubspot_stage_label', type: 'varchar', length: 255, nullable: true })
  hubspotStageLabel: string | null;

  @Column({ name: 'mycase_status', type: 'varchar', length: 100 })
  mycaseStatus: string;

  @Column({ name: 'direction', type: 'varchar', length: 10, default: 'both' })
  direction: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
