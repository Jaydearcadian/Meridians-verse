import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only event store (issue #666).
 *
 * Every audit-relevant occurrence is recorded here as an immutable
 * `AuditEvent` before any projection is updated. Rows in this table must
 * never be updated or deleted — the append-only invariant is what makes
 * replay and snapshotting sound.
 *
 * `sequenceNo` is a database-assigned monotonic sequence (bigserial) that
 * defines the total order of events. Projections track the last applied
 * sequence so replay can resume exactly where they left off.
 */
@Entity('audit_events')
@Index(['aggregateId', 'sequenceNo'])
@Index(['eventType'])
export class AuditEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  /** Monotonic total order, assigned by the DB sequence. */
  @Column({ type: 'bigint', unique: true })
  sequenceNo: number;

  /**
   * Discriminator for the event payload, e.g.
   * `audit.entry.created`, `audit.contract_event.recorded`,
   * `contract_event.ingested`.
   */
  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  /**
   * Identifies the aggregate the event belongs to (e.g. `audit_log:<id>`,
   * `contract:<address>`, `leaderboard_epoch:<n>`).
   */
  @Column({ type: 'varchar', length: 255 })
  aggregateId: string;

  /** Event-specific data (context fields, previous/new values, etc.). */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Cross-cutting metadata: correlationId, actor info, ip, etc. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  timestamp: Date;
}
