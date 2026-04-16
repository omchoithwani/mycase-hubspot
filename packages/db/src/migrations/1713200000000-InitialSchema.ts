import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1713200000000 implements MigrationInterface {
  name = 'InitialSchema1713200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── installations ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "installations" (
        "id"                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "hubspot_portal_id"         VARCHAR(50)  NOT NULL UNIQUE,
        "hubspot_access_token"      TEXT         NOT NULL,
        "hubspot_refresh_token"     TEXT         NOT NULL,
        "hubspot_token_expires_at"  TIMESTAMPTZ  NOT NULL,
        "mycase_access_token"       TEXT,
        "mycase_refresh_token"      TEXT,
        "mycase_token_expires_at"   TIMESTAMPTZ,
        "mycase_base_url"           VARCHAR(255),
        "mycase_connected"          BOOLEAN      NOT NULL DEFAULT FALSE,
        "sync_enabled"              BOOLEAN      NOT NULL DEFAULT TRUE,
        "created_at"                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updated_at"                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // ── sync_records ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "sync_records" (
        "id"                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"   UUID        NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "object_type"       VARCHAR(30) NOT NULL,
        "hubspot_object_id" VARCHAR(100) NOT NULL,
        "mycase_object_id"  VARCHAR(100) NOT NULL,
        "last_synced_at"    TIMESTAMPTZ,
        "last_synced_hash"  VARCHAR(64),
        "sync_direction"    VARCHAR(10) NOT NULL DEFAULT 'both',
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE("installation_id", "object_type", "hubspot_object_id"),
        UNIQUE("installation_id", "object_type", "mycase_object_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_sync_records_installation_type"
      ON "sync_records"("installation_id", "object_type")
    `);

    // ── field_mappings ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "field_mappings" (
        "id"               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"  UUID         NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "object_type"      VARCHAR(30)  NOT NULL,
        "hubspot_field"    VARCHAR(255) NOT NULL,
        "mycase_field"     VARCHAR(255) NOT NULL,
        "direction"        VARCHAR(10)  NOT NULL DEFAULT 'both',
        "transform_type"   VARCHAR(50)  NOT NULL DEFAULT 'direct',
        "transform_config" JSONB,
        "is_required"      BOOLEAN      NOT NULL DEFAULT FALSE,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE("installation_id", "object_type", "hubspot_field", "mycase_field")
      )
    `);

    // ── stage_mappings ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "stage_mappings" (
        "id"                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"      UUID         NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "hubspot_pipeline_id"  VARCHAR(100) NOT NULL,
        "hubspot_stage_id"     VARCHAR(100) NOT NULL,
        "hubspot_stage_label"  VARCHAR(255),
        "mycase_status"        VARCHAR(100) NOT NULL,
        "direction"            VARCHAR(10)  NOT NULL DEFAULT 'both',
        "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE("installation_id", "hubspot_pipeline_id", "hubspot_stage_id")
      )
    `);

    // ── sync_criteria ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "sync_criteria" (
        "id"               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"  UUID        NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "object_type"      VARCHAR(30) NOT NULL,
        "source_system"    VARCHAR(10) NOT NULL,
        "rule_name"        VARCHAR(255),
        "logic_operator"   VARCHAR(5)  NOT NULL DEFAULT 'AND',
        "conditions"       JSONB       NOT NULL,
        "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── sync_jobs ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "sync_jobs" (
        "id"               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"  UUID        NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "bull_job_id"      VARCHAR(100),
        "object_type"      VARCHAR(30) NOT NULL,
        "direction"        VARCHAR(10) NOT NULL,
        "source_id"        VARCHAR(100) NOT NULL,
        "destination_id"   VARCHAR(100),
        "status"           VARCHAR(20) NOT NULL DEFAULT 'pending',
        "attempt_count"    INTEGER     NOT NULL DEFAULT 1,
        "payload_snapshot" JSONB,
        "error_message"    TEXT,
        "started_at"       TIMESTAMPTZ,
        "completed_at"     TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_sync_jobs_installation_created"
      ON "sync_jobs"("installation_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_sync_jobs_installation_type_status"
      ON "sync_jobs"("installation_id", "object_type", "status")
    `);

    // ── error_logs ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "error_logs" (
        "id"               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"  UUID        NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "sync_job_id"      UUID        REFERENCES "sync_jobs"("id"),
        "object_type"      VARCHAR(30) NOT NULL,
        "direction"        VARCHAR(10) NOT NULL,
        "source_id"        VARCHAR(100) NOT NULL,
        "error_code"       VARCHAR(50) NOT NULL,
        "error_message"    TEXT        NOT NULL,
        "raw_response"     JSONB,
        "resolved"         BOOLEAN     NOT NULL DEFAULT FALSE,
        "retry_count"      INTEGER     NOT NULL DEFAULT 0,
        "next_retry_at"    TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_error_logs_installation_resolved"
      ON "error_logs"("installation_id", "resolved", "created_at" DESC)
    `);

    // ── polling_cursors ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "polling_cursors" (
        "id"               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        "installation_id"  UUID        NOT NULL REFERENCES "installations"("id") ON DELETE CASCADE,
        "object_type"      VARCHAR(30) NOT NULL,
        "last_polled_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "last_cursor"      VARCHAR(255),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE("installation_id", "object_type")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "polling_cursors" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "error_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_jobs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_criteria" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stage_mappings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "field_mappings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_records" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "installations" CASCADE`);
  }
}
