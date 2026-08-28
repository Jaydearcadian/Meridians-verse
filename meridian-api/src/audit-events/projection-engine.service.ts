import { Injectable, Logger } from '@nestjs/common';
import { EventStoreService } from './event-store.service';
import {
  ProjectionCheckpointService,
} from './projection-checkpoint.service';
import { SnapshotService } from './snapshot.service';

/**
 * A projection consumes events in total order and maintains a read model.
 * `apply` must be idempotent per sequence number (the engine guarantees
 * each event is delivered at most once per pass).
 */
export interface Projection {
  /** Unique name, used for checkpoint + snapshot keys. */
  readonly name: string;
  /** Which event types this projection cares about. Empty = all. */
  readonly eventTypes: readonly string[];
  /** Restore in-memory state from a snapshot payload. */
  restore(state: Record<string, unknown>): void;
  /** Serialise current in-memory state for snapshotting. */
  snapshotState(): Record<string, unknown>;
  /** Apply one event to the read model. */
  apply(event: {
    sequenceNo: number;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    timestamp: Date;
  }): Promise<void>;
}

/** How often (in applied events) a projection snapshots itself. */
export const SNAPSHOT_INTERVAL_EVENTS = Number(
  process.env.PROJECTION_SNAPSHOT_INTERVAL ?? '1000',
);

/**
 * Drives all projections over the shared event log (issue #666).
 *
 * One `runOnce` pass reads new events from the store and delivers them, in
 * order, to every interested projection, then advances that projection's
 * checkpoint. Replay = reset checkpoints (+ optionally clear read models)
 * and run again; replay-from-snapshot restores state first.
 */
@Injectable()
export class ProjectionEngine {
  private readonly logger = new Logger(ProjectionEngine.name);
  private projections: Projection[] = [];
  private countersSinceSnapshot = new Map<string, number>();

  constructor(
    private readonly eventStore: EventStoreService,
    private readonly checkpoints: ProjectionCheckpointService,
    private readonly snapshots: SnapshotService,
  ) {}

  register(projection: Projection): void {
    this.projections.push(projection);
  }

  /**
   * Apply all events after `fromSequenceNo` to every registered projection.
   * When fromSequenceNo is omitted, each projection resumes from its own
   * checkpoint.
   */
  async runOnce(fromSequenceNo?: number): Promise<{
    applied: Record<string, number>;
    head: number;
  }> {
    const applied: Record<string, number> = {};
    let head = await this.eventStore.headSequenceNo();

    for (const projection of this.projections) {
      // Explicit fromSequenceNo wins over the checkpoint (replay mode);
      // otherwise resume from where this projection left off.
      const start =
        fromSequenceNo ?? (await this.checkpoints.get(projection.name));
      if (start >= head) {
        applied[projection.name] = 0;
        continue;
      }

      let last = start;
      let count = 0;
      // Page through the log in order.
      for (;;) {
        const events = await this.eventStore.readEvents(last);
        if (events.length === 0) break;

        for (const event of events) {
          const seq = Number((event as any).sequenceNo);
          if (
            projection.eventTypes.length === 0 ||
            projection.eventTypes.includes(event.eventType)
          ) {
            await projection.apply({
              sequenceNo: seq,
              eventType: event.eventType,
              aggregateId: event.aggregateId,
              payload: event.payload,
              metadata: event.metadata,
              timestamp: event.timestamp,
            });
          }
          last = seq;
          count++;
        }

        await this.checkpoints.set(projection.name, last);

        // Periodic snapshotting.
        const since =
          (this.countersSinceSnapshot.get(projection.name) ?? 0) + events.length;
        this.countersSinceSnapshot.set(projection.name, since);
        if (since >= SNAPSHOT_INTERVAL_EVENTS) {
          await this.snapshots.save(
            projection.name,
            last,
            projection.snapshotState(),
          );
          this.countersSinceSnapshot.set(projection.name, 0);
        }

        if (events.length < 1000) break; // last page
      }

      applied[projection.name] = count;
      head = Math.max(head, last);
    }

    return { applied, head };
  }

  /**
   * Rebuild a projection: restore its latest snapshot (if any), reset its
   * checkpoint to the snapshot's sequence, then apply everything newer.
   * Returns the sequence the projection ended at.
   */
  async replayProjection(
    projectionName: string,
    opts: { force?: boolean } = {},
  ): Promise<{ replayedTo: number; fromSnapshot: boolean }> {
    const projection = this.projections.find((p) => p.name === projectionName);
    if (!projection) {
      throw new Error(`Unknown projection: ${projectionName}`);
    }

    const current = await this.checkpoints.get(projectionName);
    let startFrom = 0;
    let fromSnapshot = false;

    if (!opts.force) {
      const snap = await this.snapshots.latest(projectionName);
      if (snap && snap.lastSequenceNo > 0) {
        try {
          projection.restore(snap.state);
          startFrom = snap.lastSequenceNo;
          fromSnapshot = true;
        } catch (err) {
          // Corrupt snapshot → fall back to full replay.
          this.logger.warn(
            `snapshot for ${projectionName} unusable (${err instanceof Error ? err.message : err}); falling back to full replay`,
          );
        }
      }
    } else {
      await projection.restore({});
    }

    // Restore semantics:
    //  - snapshot restore → state reflects `startFrom`; apply events after it
    //  - forced/empty restore → state is empty; apply ALL events
    await this.checkpoints.set(projectionName, startFrom);
    await this.runOnce(startFrom);
    const end = await this.checkpoints.get(projectionName);
    return { replayedTo: end, fromSnapshot };
  }

  registeredProjections(): string[] {
    return this.projections.map((p) => p.name);
  }
}
