import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangedFields1715000000000 implements MigrationInterface {
  name = 'AddChangedFields1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "changed_fields" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" DROP COLUMN IF EXISTS "changed_fields"`,
    );
  }
}
