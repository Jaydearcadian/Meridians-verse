import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Concurrent session management & device tracking (issue #665): adds the
 * per-session device metadata columns to the refresh_token table. Existing
 * rows keep NULL device fields (grandfathered sessions) so nothing regresses.
 */
export class AddSessionDeviceColumns1787400000000 implements MigrationInterface {
  name = 'AddSessionDeviceColumns1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "deviceName" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "ipAddress" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "location" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN IF EXISTS "lastUsedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN IF EXISTS "location"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN IF EXISTS "ipAddress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN IF EXISTS "deviceName"`,
    );
  }
}
