import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectionSnapshot } from './projection-snapshot.entity';

export interface SnapshotRow {
  projectionName: string;
  lastSequenceNo: number;
  state: Record<string, unknown>;
}

/**
 * Snapshot storage for projections (issue #666).
 *
 * A snapshot captures a projection's state at a known sequence number so
 * replay can resume from it instead of re-reading the entire event log.
 * Snapshots are an optimisation only: correctness must never depend on
 * them (a corrupt/missing snapshot falls back to full replay).
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    @InjectRepository(ProjectionSnapshot)
    private readonly repo: Repository<ProjectionSnapshot>,
  ) {}

  /** Latest snapshot for a projection, or null. */
  async latest(projectionName: string): Promise<SnapshotRow | null> {
    const row = await this.repo.findOne({
      where: { projectionName },
      order: { lastSequenceNo: 'DESC' },
    });
    return row
      ? {
          projectionName: row.projectionName,
          lastSequenceNo: Number(row.lastSequenceNo),
          state: row.state,
        }
      : null;
  }

  async save(
    projectionName: string,
    lastSequenceNo: number,
    state: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.save({
      projectionName,
      lastSequenceNo,
      state,
    } as any);
    this.logger.debug(`snapshot saved: ${projectionName} @ ${lastSequenceNo}`);
  }
}
