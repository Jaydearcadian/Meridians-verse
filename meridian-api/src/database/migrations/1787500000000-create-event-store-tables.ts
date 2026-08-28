import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Event-sourced audit (issue #666): creates the append-only event store
 * plus the projection bookkeeping and snapshot tables.
 */
export class CreateEventStoreTables1787500000000 implements MigrationInterface {
  name = 'CreateEventStoreTables1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Append-only event store.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_events" (
        "id" BIGSERIAL PRIMARY KEY,
        "sequenceNo" BIGINT UNIQUE NOT NULL,
        "eventType" VARCHAR(100) NOT NULL,
        "aggregateId" VARCHAR(255) NOT NULL,
        "payload" JSONB NOT NULL,
        "metadata" JSONB NULL,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // sequenceNo must draw from its own sequence so it is gap-free per row
    // and strictly monotonic even under concurrent appends.
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "audit_events_sequenceNo_seq" OWNED BY "audit_events"."sequenceNo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_events" ALTER COLUMN "sequenceNo" SET DEFAULT nextval('audit_events_sequenceNo_seq')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_events_aggregate_seq" ON "audit_events" ("aggregateId", "sequenceNo")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_events_eventType" ON "audit_events" ("eventType")`,
    );

    // 2. Projection cursors: how far each projection has applied the log.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "projection_checkpoints" (
        "projectionName" VARCHAR(100) PRIMARY KEY,
        "lastSequenceNo" BIGINT NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // 3. Snapshots for fast replay resume.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "projection_snapshots" (
        "id" BIGSERIAL PRIMARY KEY,
        "projectionName" VARCHAR(100) NOT NULL,
        "lastSequenceNo" BIGINT NOT NULL,
        "state" JSONB NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_projection_snapshots_name_seq" ON "projection_snapshots" ("projectionName", "lastSequenceNo" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "projection_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projection_checkpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_events"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "audit_events_sequenceNo_seq"`);
  }
}
