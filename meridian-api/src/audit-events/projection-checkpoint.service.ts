import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectionCheckpoint } from './projection-checkpoint.entity';

/**
 * Tracks how far each projection has applied the event log (issue #666).
 * The checkpoint is what makes replay resumable and idempotent.
 */
@Injectable()
export class ProjectionCheckpointService implements OnModuleDestroy {
  private readonly logger = new Logger(ProjectionCheckpointService.name);
  private cache = new Map<string, number>();

  constructor(
    @InjectRepository(ProjectionCheckpoint)
    private readonly repo: Repository<ProjectionCheckpoint>,
  ) {}

  async get(projectionName: string): Promise<number> {
    if (this.cache.has(projectionName)) {
      return this.cache.get(projectionName)!;
    }
    const row = await this.repo.findOne({ where: { projectionName } });
    const value = row ? Number(row.lastSequenceNo) : 0;
    this.cache.set(projectionName, value);
    return value;
  }

  async set(projectionName: string, lastSequenceNo: number): Promise<void> {
    await this.repo.query(
      `INSERT INTO "projection_checkpoints" ("projectionName", "lastSequenceNo", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("projectionName") DO UPDATE SET "lastSequenceNo" = $2, "updatedAt" = now()`,
      [projectionName, lastSequenceNo],
    );
    this.cache.set(projectionName, lastSequenceNo);
  }

  /** Reset so the next apply pass replays everything (used by /audit/replay). */
  async reset(projectionName: string): Promise<void> {
    this.cache.delete(projectionName);
    await this.repo.query(
      `INSERT INTO "projection_checkpoints" ("projectionName", "lastSequenceNo", "updatedAt")
       VALUES ($1, 0, now())
       ON CONFLICT ("projectionName") DO UPDATE SET "lastSequenceNo" = 0, "updatedAt" = now()`,
      [projectionName],
    );
  }

  onModuleDestroy() {
    // write-through cache; nothing to flush
  }
}
