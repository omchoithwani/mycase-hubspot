import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMycaseWebBaseUrl1714500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE installations
      ADD COLUMN IF NOT EXISTS mycase_web_base_url VARCHAR(255) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE installations
      DROP COLUMN IF EXISTS mycase_web_base_url;
    `);
  }
}
