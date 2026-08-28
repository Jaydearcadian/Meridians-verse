import { Injectable, Logger } from '@nestjs/common';
import type { Projection } from './projection-engine.service';

export interface LeaderboardEntryView {
  txHash: string;
  contract: string;
  contractAction: string;
  blockNumber: number;
  chainHash: string;
  participantAddress: string | null;
  contributionXp: number;
  epochNumber: number | null;
  stateRoot: string | null;
}

/**
 * In-memory + snapshot-backed read model of per-epoch leaderboard entries
 * (issue #666). Built from `audit.contract_event.recorded` events so
 * LeaderboardProofService no longer queries the raw audit table.
 */
@Injectable()
export class LeaderboardProjection implements Projection {
  readonly name = 'leaderboard-projection';
  readonly eventTypes: readonly string[] = ['audit.contract_event.recorded'];

  private readonly logger = new Logger(LeaderboardProjection.name);
  /** epoch -> ordered entries (append order == event order) */
  private entriesByEpoch = new Map<number, LeaderboardEntryView[]>();

  restore(state: Record<string, unknown>): void {
    this.entriesByEpoch = new Map();
    const restored = (state.entriesByEpoch ?? {}) as Record<
      string,
      LeaderboardEntryView[]
    >;
    for (const [epoch, entries] of Object.entries(restored)) {
      this.entriesByEpoch.set(Number(epoch), entries);
    }
  }

  snapshotState(): Record<string, unknown> {
    const out: Record<string, LeaderboardEntryView[]> = {};
    for (const [epoch, entries] of this.entriesByEpoch) {
      out[String(epoch)] = entries;
    }
    return { entriesByEpoch: out };
  }

  async apply(event: {
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const epoch = event.payload.epochNumber as number | null;
    if (epoch == null) return;

    const list = this.entriesByEpoch.get(epoch) ?? [];
    list.push({
      txHash: event.payload.txHash as string,
      contract: event.payload.contract as string,
      contractAction: event.payload.contractAction as string,
      blockNumber: event.payload.blockNumber as number,
      chainHash: event.payload.chainHash as string,
      participantAddress: (event.payload.participantAddress as string) ?? null,
      contributionXp: (event.payload.contributionXp as number) ?? 0,
      epochNumber: epoch,
      stateRoot: (event.payload.stateRoot as string) ?? null,
    });
    this.entriesByEpoch.set(epoch, list);
  }

  /** Ordered entries for one address in an epoch. */
  getEntriesFor(address: string, epoch: number): LeaderboardEntryView[] {
    return (this.entriesByEpoch.get(epoch) ?? []).filter(
      (e) => e.participantAddress === address,
    );
  }

  /** All ordered entries in an epoch (the merkle leaf set). */
  getAllEntries(epoch: number): LeaderboardEntryView[] {
    return this.entriesByEpoch.get(epoch) ?? [];
  }

  knownEpochs(): number[] {
    return [...this.entriesByEpoch.keys()].sort((a, b) => a - b);
  }
}
