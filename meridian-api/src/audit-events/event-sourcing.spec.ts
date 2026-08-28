/**
 * Event-sourcing core tests (issue #666).
 *
 * Covers the four dimensions the issue requires:
 *   1. event ordering
 *   2. projection consistency
 *   3. snapshot correctness
 *   4. replay idempotency
 *
 * The store/projections are exercised against in-memory mocks that honour
 * the same contracts TypeORM provides, keeping these tests hermetic.
 */

describe('Event sourcing (issue #666)', () => {
  // ---- harness -----------------------------------------------------------
  function makeStoreMock() {
    let seq = 0;
    const rows: any[] = [];
    return {
      rows,
      create: jest.fn((e: any) => ({ ...e })),
      save: jest.fn(async (e: any) => {
        seq += 1;
        const row = { sequenceNo: seq, timestamp: new Date(), ...e };
        rows.push(row);
        return row;
      }),
      queryBuilder: null as any,
      createQueryBuilder: jest.fn(() => {
        let from = 0;
        const qb = {
          where: jest.fn((_c: string, params?: any) => {
            if (params?.from != null) from = Number(params.from);
            return qb;
          }),
          andWhere: jest.fn((_c: string, params?: any) => {
            if (params?.from != null) from = Number(params.from);
            return qb;
          }),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn((n: number) => {
            qb._limit = n;
            return qb;
          }) as any,
          _limit: 1000,
          getMany: async () =>
            rows
              .filter((r) => Number(r.sequenceNo) > from)
              .sort((a, b) => a.sequenceNo - b.sequenceNo)
              .slice(0, (qb as any)._limit),
          getRawOne: async () => ({
            max: rows.length ? String(rows[rows.length - 1].sequenceNo) : '0',
          }),
          select: jest.fn().mockReturnThis(),
        };
        return qb;
      }),
      count: jest.fn(async () => rows.length),
    };
  }

  function makeCheckpointsMock() {
    const state = new Map<string, number>();
    return {
      state,
      get: jest.fn(async (n: string) => state.get(n) ?? 0),
      set: jest.fn(async (n: string, v: number) => void state.set(n, v)),
      reset: jest.fn(async (n: string) => void state.set(n, 0)),
    };
  }

  function makeSnapshotsMock() {
    // Rows mirror the real SnapshotService contract: `lastSequenceNo` is the
    // field the engine reads.
    const saved: Array<{ name: string; lastSequenceNo: number; state: any }> = [];
    return {
      saved,
      latest: jest.fn(async (name: string) => {
        const mine = saved.filter((s) => s.name === name);
        return mine.length ? mine[mine.length - 1] : null;
      }),
      save: jest.fn(async (name: string, lastSequenceNo: number, state: any) => {
        saved.push({ name, lastSequenceNo, state });
      }),
    };
  }

  async function build() {
    const storeModule = await import('./event-store.service');
    const engineModule = await import('./projection-engine.service');
    const cpModule = await import('./projection-checkpoint.service');
    const snapModule = await import('./snapshot.service');

    const storeMock = makeStoreMock();
    const store = new storeModule.EventStoreService(storeMock as any);
    (store as any).eventRepository = storeMock;
    const checkpoints = new cpModule.ProjectionCheckpointService(
      {} as any,
    );
    Object.assign(checkpoints, makeCheckpointsMock());
    const snapshots = new snapModule.SnapshotService({} as any);
    Object.assign(snapshots, makeSnapshotsMock());
    const engine = new engineModule.ProjectionEngine(
      store,
      checkpoints,
      snapshots,
    );
    return { store, checkpoints, snapshots, engine, storeMock };
  }

  // ---- 1. event ordering -------------------------------------------------
  describe('event ordering', () => {
    it('appends events with strictly increasing sequence numbers', async () => {
      const { store } = await build();

      const e1 = await store.append({
        eventType: 'audit.entry.created',
        aggregateId: 'agg-1',
        payload: { n: 1 },
      });
      const e2 = await store.append({
        eventType: 'audit.entry.created',
        aggregateId: 'agg-1',
        payload: { n: 2 },
      });
      const e3 = await store.append({
        eventType: 'audit.contract_event.recorded',
        aggregateId: 'agg-2',
        payload: { n: 3 },
      });

      expect(Number(e1.sequenceNo)).toBeLessThan(Number(e2.sequenceNo));
      expect(Number(e2.sequenceNo)).toBeLessThan(Number(e3.sequenceNo));
      expect(await store.headSequenceNo()).toBe(3);
    });

    it('readEvents returns events in total order', async () => {
      const { store } = await build();
      for (let i = 0; i < 5; i++) {
        await store.append({
          eventType: 'audit.entry.created',
          aggregateId: `agg-${i}`,
          payload: { i },
        });
      }
      const events = await store.readEvents(0);
      const seqs = events.map((e) => Number((e as any).sequenceNo));
      const sorted = [...seqs].sort((a, b) => a - b);
      expect(seqs).toEqual(sorted);
    });
  });

  // ---- 2. projection consistency ------------------------------------------
  describe('projection consistency', () => {
    class CountingProjection {
      readonly name = 'counting';
      readonly eventTypes: readonly string[] = [];
      total = 0;
      seen: number[] = [];
      restore(state: Record<string, unknown>) {
        this.total = (state.total as number) ?? 0;
        this.seen = (state.seen as number[]) ?? [];
      }
      snapshotState() {
        return { total: this.total, seen: this.seen };
      }
      async apply(event: any) {
        this.total += 1;
        this.seen.push(event.sequenceNo);
      }
    }

    it('applies every event exactly once per pass', async () => {
      const { store, checkpoints, engine } = await build();
      for (let i = 0; i < 7; i++) {
        await store.append({
          eventType: 'audit.entry.created',
          aggregateId: 'a',
          payload: {},
        });
      }

      const p = new CountingProjection();
      engine.register(p);

      await engine.runOnce();
      expect((checkpoints as any).state.get('counting')).toBe(7);
      expect(p.total).toBe(7);

      // A second pass must not double-apply (idempotent cursor).
      const second = await engine.runOnce();
      expect(second.applied['counting']).toBe(0);
      expect(p.total).toBe(7);
      expect(new Set(p.seen).size).toBe(p.seen.length);
    });
  });

  // ---- 3. snapshot correctness --------------------------------------------
  describe('snapshot correctness', () => {
    it('replay from snapshot produces identical state to full replay', async () => {
      const { store, checkpoints, engine, snapshots } = await build();
      const { LeaderboardProjection } = await import('./leaderboard.projection');

      for (let i = 0; i < 3; i++) {
        await store.append({
          eventType: 'audit.contract_event.recorded',
          aggregateId: 'contract:x',
          payload: {
            txHash: `tx-${i}`,
            contract: 'x',
            contractAction: 'created',
            blockNumber: i,
            chainHash: `hash-${i}`,
            participantAddress: 'GABC',
            contributionXp: 10,
            epochNumber: 1,
          },
        });
      }

      const proj = new LeaderboardProjection();
      engine.register(proj);

      // Apply all events through the engine so the projection has state.
      await engine.runOnce();
      expect(proj.getEntriesFor('GABC', 1)).toHaveLength(3);

      // Force a snapshot of the applied state, then verify a fresh
      // projection restored from it is identical to full replay.
      await snapshots.save('leaderboard-projection', 3, proj.snapshotState());

      // Force a snapshot then simulate restart: restore into a new instance.
      snapshots.save('leaderboard-projection', 3, proj.snapshotState());
      const restored = new LeaderboardProjection();
      const snap = await snapshots.latest('leaderboard-projection');
      restored.restore(snap!.state);

      expect(restored.getEntriesFor('GABC', 1)).toHaveLength(3);
      expect(restored.getAllEntries(1).map((e) => e.txHash)).toEqual([
        'tx-0',
        'tx-1',
        'tx-2',
      ]);
      expect(JSON.stringify(restored.snapshotState())).not.toBe('{}');
    });
  });

  // ---- 4. replay idempotency ----------------------------------------------
  describe('replay idempotency', () => {
    it('double replay ends at the same checkpoint with unchanged state', async () => {
      const { store, checkpoints, engine, snapshots } = await build();
      const { LeaderboardProjection } = await import('./leaderboard.projection');

      for (let i = 0; i < 4; i++) {
        await store.append({
          eventType: 'audit.contract_event.recorded',
          aggregateId: 'contract:x',
          payload: {
            txHash: `tx-${i}`,
            contract: 'x',
            contractAction: 'created',
            blockNumber: i,
            chainHash: `hash-${i}`,
            participantAddress: 'GABC',
            epochNumber: 2,
          },
        });
      }

      const proj = new LeaderboardProjection();
      engine.register(proj);

      await engine.runOnce();
      // Snapshot the applied state (the periodic policy snapshots once
      // PROJECTION_SNAPSHOT_INTERVAL events have been applied).
      await snapshots.save('leaderboard-projection', 4, proj.snapshotState());
      const afterFirst = JSON.stringify(proj.snapshotState());

      const r1 = await engine.replayProjection('leaderboard-projection');
      const afterReplay1 = JSON.stringify(proj.snapshotState());
      const r2 = await engine.replayProjection('leaderboard-projection');
      const afterReplay2 = JSON.stringify(proj.snapshotState());

      expect(r1.replayedTo).toBe(r2.replayedTo);
      expect(afterReplay1).toBe(afterReplay2);
      // State never shrank or duplicated entries.
      expect(proj.getAllEntries(2)).toHaveLength(4);
      expect(afterFirst).toBe(afterReplay1);
      expect((checkpoints as any).state.get('leaderboard-projection')).toBe(4);
    });

    it('falls back to full replay when the snapshot is corrupt', async () => {
      const { store, checkpoints, engine, snapshots } = await build();
      const { LeaderboardProjection } = await import('./leaderboard.projection');

      for (let i = 0; i < 3; i++) {
        await store.append({
          eventType: 'audit.contract_event.recorded',
          aggregateId: 'contract:x',
          payload: {
            txHash: `t-${i}`,
            contract: 'x',
            contractAction: 'a',
            blockNumber: i,
            chainHash: `h-${i}`,
            participantAddress: 'G',
            epochNumber: 9,
          },
        });
      }

      const proj = new LeaderboardProjection();
      engine.register(proj);
      await engine.runOnce();

      // Poison the snapshot with state that makes restore() itself fail.
      const poison: any = {};
      Object.defineProperty(poison, 'entriesByEpoch', {
        get() {
          throw new Error('corrupt snapshot');
        },
        enumerable: true,
      });
      snapshots.save('leaderboard-projection', 99, poison);

      const result = await engine.replayProjection('leaderboard-projection');
      expect(result.fromSnapshot).toBe(false);
      expect(result.replayedTo).toBe(3);
    });
  });

  // ---- publisher guard -----------------------------------------------------
  describe('EventPublisher', () => {
    it('rejects events missing type or aggregate id', async () => {
      const { EventPublisher } = await import('./event-publisher.service');
      const { EventStoreService } = await import('./event-store.service');
      const store = new EventStoreService({} as any);
      const publisher = new EventPublisher(store);

      await expect(
        publisher.publish({ eventType: '', aggregateId: 'a', payload: {} }),
      ).rejects.toThrow();
      await expect(
        publisher.publish({ eventType: 't', aggregateId: '', payload: {} }),
      ).rejects.toThrow();
    });
  });
});
