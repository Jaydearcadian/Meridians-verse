import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Persisted projection state at a known sequence number. */
@Entity('projection_snapshots')
@Index(['projectionName', 'lastSequenceNo'])
export class ProjectionSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  projectionName: string;

  @Column({ type: 'bigint' })
  lastSequenceNo: number;

  @Column({ type: 'jsonb' })
  state: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
