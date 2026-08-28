import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditLog, AuditAction } from './audit-log.entity';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import { EventPublisher } from 'src/audit-events/event-publisher.service';

export interface AuditContext {
  entityName: string;
  entityId?: string | number | null;
  action: AuditAction;
  performedById?: number | null;
  performedByEmail?: string | null;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  correlationId?: string | null;
}

export interface ContractEventContext {
  txHash: string;
  contract: string;
  contractAction: string;
  blockNumber: number;
  rawEvent?: Record<string, unknown> | null;
  entityName?: string;
  entityId?: string | null;
  performedById?: number | null;
  performedByEmail?: string | null;
  participantAddress?: string | null;
  contributionXp?: number;
  epochNumber?: number | null;
  stateRoot?: string | null;
  correlationId?: string | null;
}

/**
 * Audit facade (issue #666 refactor).
 *
 * Producers call `log` / `logContractEvent` exactly as before; internally
 * the calls are now published as events to the append-only event store.
 * The `audit_logs` table is maintained by `AuditLogProjection` consuming
 * those events — it is a read model, not a write target.
 *
 * When the event publisher is unavailable (e.g. stripped test modules),
 * the service degrades to direct writes so existing behaviour is preserved
 * rather than silently dropping audit records.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly correlationIdStore: CorrelationIdStore,
    @Optional() private readonly eventPublisher?: EventPublisher,
  ) {}

  private resolveCorrelationId(explicit?: string | null): string | null {
    return explicit ?? this.correlationIdStore.get() ?? null;
  }

  async log(ctx: AuditContext): Promise<void> {
    const correlationId = this.resolveCorrelationId(ctx.correlationId);
    this.logger.log(
      JSON.stringify({
        msg: 'audit.log',
        entityName: ctx.entityName,
        action: ctx.action,
        correlationId,
      }),
    );

    if (this.eventPublisher) {
      await this.eventPublisher.publish({
        eventType: 'audit.entry.created',
        aggregateId: `audit_log:${ctx.entityName}:${ctx.entityId ?? '-'}`,
        payload: {
          entityName: ctx.entityName,
          entityId: ctx.entityId != null ? String(ctx.entityId) : null,
          action: ctx.action,
          performedById: ctx.performedById ?? null,
          performedByEmail: ctx.performedByEmail ?? null,
          previousValues: ctx.previousValues ?? null,
          newValues: ctx.newValues ?? null,
          ipAddress: ctx.ipAddress ?? null,
          correlationId,
        },
        metadata: { source: 'AuditService.log' },
      });
      return;
    }

    // Fallback (publisher absent): preserve legacy direct-write behaviour.
    const entry = this.auditRepo.create({
      entityName: ctx.entityName,
      entityId: ctx.entityId != null ? String(ctx.entityId) : null,
      action: ctx.action,
      performedById: ctx.performedById ?? null,
      performedByEmail: ctx.performedByEmail ?? null,
      previousValues: ctx.previousValues ?? null,
      newValues: ctx.newValues ?? null,
      ipAddress: ctx.ipAddress ?? null,
      correlationId,
    });
    await this.auditRepo.save(entry);
  }

  async logContractEvent(ctx: ContractEventContext): Promise<AuditLog> {
    if (!this.eventPublisher) {
      // Fallback: legacy direct write with chain hash computed locally.
      return this.writeContractEventDirect(ctx);
    }

    await this.eventPublisher.publish({
      eventType: 'audit.contract_event.recorded',
      aggregateId: `contract:${ctx.contract}`,
      payload: {
        entityName: ctx.entityName || ctx.contract,
        entityId: ctx.entityId ?? null,
        txHash: ctx.txHash,
        contract: ctx.contract,
        contractAction: ctx.contractAction,
        blockNumber: ctx.blockNumber,
        rawEvent: ctx.rawEvent ?? null,
        participantAddress: ctx.participantAddress ?? null,
        contributionXp: ctx.contributionXp ?? 0,
        epochNumber: ctx.epochNumber ?? null,
        stateRoot: ctx.stateRoot ?? null,
        correlationId: this.resolveCorrelationId(ctx.correlationId),
      },
      metadata: { source: 'AuditService.logContractEvent' },
    });

    // Preserve the historical return contract: callers received the saved
    // row. Read it back from the projection once applied.
    const projected = await this.auditRepo.findOne({
      where: { txHash: ctx.txHash, contractAction: ctx.contractAction },
      order: { id: 'DESC' },
    });
    return (
      projected ??
      ({
        txHash: ctx.txHash,
        contract: ctx.contract,
        contractAction: ctx.contractAction,
      } as AuditLog)
    );
  }

  /** Legacy direct write used only when the publisher is unavailable. */
  private async writeContractEventDirect(
    ctx: ContractEventContext,
  ): Promise<AuditLog> {
    const previousEntry = await this.auditRepo.findOne({
      where: { action: AuditAction.CONTRACT_EVENT },
      order: { id: 'DESC' },
    });

    const previousHash = previousEntry?.chainHash ?? null;
    const payload = `${ctx.txHash}:${ctx.contract}:${ctx.contractAction}:${ctx.blockNumber}:${JSON.stringify(ctx.rawEvent || {})}:${previousHash ?? ''}`;
    const chainHash = createHash('sha256').update(payload).digest('hex');

    const entry = this.auditRepo.create({
      entityName: ctx.entityName || ctx.contract,
      entityId: ctx.entityId ?? null,
      action: AuditAction.CONTRACT_EVENT,
      correlationId: this.resolveCorrelationId(ctx.correlationId),
      txHash: ctx.txHash,
      contract: ctx.contract,
      contractAction: ctx.contractAction,
      blockNumber: ctx.blockNumber,
      previousHash,
      chainHash,
      stateRoot: ctx.stateRoot ?? null,
      rawEvent: ctx.rawEvent ?? null,
      participantAddress: ctx.participantAddress ?? null,
      contributionXp: ctx.contributionXp ?? 0,
      epochNumber: ctx.epochNumber ?? null,
    });
    return this.auditRepo.save(entry);
  }
}
