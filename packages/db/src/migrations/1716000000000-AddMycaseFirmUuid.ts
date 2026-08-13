import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMycaseFirmUuid1716000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE installations
      ADD COLUMN IF NOT EXISTS mycase_firm_uuid VARCHAR(100) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE installations
      DROP COLUMN IF EXISTS mycase_firm_uuid;
    `);
  }
}
