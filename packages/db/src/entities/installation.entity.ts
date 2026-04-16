import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

@Entity('installations')
export class Installation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hubspot_portal_id', type: 'varchar', length: 50, unique: true })
  hubspotPortalId: string;

  @Column({ name: 'hubspot_access_token', type: 'text' })
  hubspotAccessToken: string;

  @Column({ name: 'hubspot_refresh_token', type: 'text' })
  hubspotRefreshToken: string;

  @Column({ name: 'hubspot_token_expires_at', type: 'timestamptz' })
  hubspotTokenExpiresAt: Date;

  @Column({ name: 'mycase_access_token', type: 'text', nullable: true })
  mycaseAccessToken: string | null;

  @Column({ name: 'mycase_refresh_token', type: 'text', nullable: true })
  mycaseRefreshToken: string | null;

  @Column({ name: 'mycase_token_expires_at', type: 'timestamptz', nullable: true })
  mycaseTokenExpiresAt: Date | null;

  @Column({ name: 'mycase_base_url', type: 'varchar', length: 255, nullable: true })
  mycaseBaseUrl: string | null;

  @Column({ name: 'mycase_connected', type: 'boolean', default: false })
  mycaseConnected: boolean;

  @Column({ name: 'sync_enabled', type: 'boolean', default: true })
  syncEnabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
