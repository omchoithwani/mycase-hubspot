import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncHistoricalData1714000000000 implements MigrationInterface {
  name = 'AddSyncHistoricalData1714000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installations"
      ADD COLUMN IF NOT EXISTS "sync_historical_data" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installations" DROP COLUMN IF EXISTS "sync_historical_data"
    `);
  }
}
