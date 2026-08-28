import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AuditLog, AuditAction } from '../audit/audit-log.entity';
import { createHash } from 'crypto';
import type { Projection } from './projection-engine.service';

/**
 * Builds and maintains the `audit_logs` read model from audit events
 * (issue #666). The table is no longer written directly by producers —
 * it is a projection of the event store.
 */
@Injectable()
export class AuditLogProjection implements Projection {
  readonly name = 'audit-log-projection';
  readonly eventTypes: readonly string[] = [
    'audit.entry.created',
    'audit.contract_event.recorded',
  ];

  private readonly logger = new Logger(AuditLogProjection.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /** No in-memory state to restore: the read model lives in `audit_logs`. */
  restore(_state: Record<string, unknown>): void {
    /* table-backed projection; replay clears/rebuilds rows via apply */
  }

  snapshotState(): Record<string, unknown> {
    return {};
  }

  async apply(event: {
    sequenceNo: number;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (event.eventType === 'audit.entry.created') {
      const exists = await this.auditRepo.findOne({
        where: { entityId: event.payload.entityId as string | null },
        order: { id: 'DESC' },
      });
      // Idempotency guard: skip if this exact event already produced the row.
      if (
        exists &&
        exists.correlationId === (event.payload.correlationId ?? null) &&
        exists.entityName === (event.payload.entityName as string) &&
        exists.action === (event.payload.action as AuditAction)
      ) {
        return;
      }
      const entry = this.auditRepo.create({
        entityName: event.payload.entityName as string,
        entityId: (event.payload.entityId as string) ?? null,
        action: event.payload.action as AuditAction,
        performedById: (event.payload.performedById as number) ?? null,
        performedByEmail: (event.payload.performedByEmail as string) ?? null,
        previousValues: (event.payload.previousValues as Record<string, unknown>) ?? null,
        newValues: (event.payload.newValues as Record<string, unknown>) ?? null,
        ipAddress: (event.payload.ipAddress as string) ?? null,
        correlationId: (event.payload.correlationId as string) ?? null,
      });
      await this.auditRepo.save(entry);
      return;
    }

    if (event.eventType === 'audit.contract_event.recorded') {
      // Chain hash must be computed in event order — the engine guarantees it.
      const previousEntry = await this.auditRepo.findOne({
        where: { action: AuditAction.CONTRACT_EVENT },
        order: { id: 'DESC' },
      });
      const previousHash = previousEntry?.chainHash ?? null;
      const txHash = event.payload.txHash as string;
      const contract = event.payload.contract as string;
      const contractAction = event.payload.contractAction as string;
      const blockNumber = event.payload.blockNumber as number;
      const rawEvent = (event.payload.rawEvent as Record<string, unknown>) || {};
      const chainPayload = `${txHash}:${contract}:${contractAction}:${blockNumber}:${JSON.stringify(rawEvent)}:${previousHash ?? ''}`;
      const chainHash = createHash('sha256').update(chainPayload).digest('hex');

      const entry = this.auditRepo.create({
        entityName: (event.payload.entityName as string) || contract,
        entityId: (event.payload.entityId as string) ?? null,
        action: AuditAction.CONTRACT_EVENT,
        correlationId: (event.payload.correlationId as string) ?? null,
        txHash,
        contract,
        contractAction,
        blockNumber,
        previousHash,
        chainHash,
        stateRoot: (event.payload.stateRoot as string) ?? null,
        rawEvent: rawEvent as any,
        participantAddress:
          (event.payload.participantAddress as string) ?? null,
        contributionXp: (event.payload.contributionXp as number) ?? 0,
        epochNumber: (event.payload.epochNumber as number) ?? null,
      });
      await this.auditRepo.save(entry);
    }
  }

  /**
   * Full rebuild support: remove projected rows so replay starts clean.
   * Only called by the admin replay path.
   */
  async clear(): Promise<void> {
    await this.auditRepo.clear();
  }
}
