import { Column, Entity } from 'typeorm';

/** Bookkeeping row: how far a projection has applied the event log. */
@Entity('projection_checkpoints')
export class ProjectionCheckpoint {
  @Column({ type: 'varchar', length: 100, primary: true })
  projectionName: string;

  @Column({ type: 'bigint', default: 0 })
  lastSequenceNo: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
