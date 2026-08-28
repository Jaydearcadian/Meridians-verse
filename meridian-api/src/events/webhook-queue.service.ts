import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, LessThan } from 'typeorm';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Webhook } from './webhook.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { CryptoProvider } from 'src/crypto/providers/crypto.provider';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import { CORRELATION_ID_RESPONSE_HEADER } from '../common/correlation/correlation-id.constants';
import type { ContractEvent } from './events.service';

interface WebhookJob {
  webhookId: string;
  url: string;
  secret: string;
  payload: string;
  correlationId: string;
  attempt: number;
  /** Original contract event, carried so successful delivery can be recorded in the event store (issue #666). */
  event?: Record<string, unknown>;
}

/**
 * Async webhook delivery queue (issue #661).
 *
 * Event ingestion enqueues delivery jobs instead of calling `fetch` inline, so
 * a slow or failing subscriber never blocks ingestion. A background worker
 * drains the queue; failed deliveries are retried with exponential backoff and
 * full jitter up to `WEBHOOK_RETRY_MAX`, after which the webhook is moved to the
 * dead-letter queue (`dlqAt` set, deactivated). Admins can list, replay and
 * purge dead letters.
 */
@Injectable()
export class WebhookQueueService implements OnModuleInit {
  private readonly logger = new Logger(WebhookQueueService.name);
  private readonly queue: WebhookJob[] = [];
  private processing = false;

  private readonly retryMax: number;
  private readonly backoffBaseMs: number;
  private readonly dlqTtlDays: number;

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    private readonly cryptoProvider: CryptoProvider,
    private readonly correlationIdStore: CorrelationIdStore,
    private readonly configService: ConfigService,
    // Event-sourced audit (issue #666): optional so existing test modules
    // that construct the queue directly keep working.
    @Optional() private readonly eventPublisher?: any,
  ) {
    this.retryMax = Number(this.configService.get('WEBHOOK_RETRY_MAX') ?? 5);
    this.backoffBaseMs = Number(
      this.configService.get('WEBHOOK_BACKOFF_BASE_MS') ?? 1000,
    );
    this.dlqTtlDays = Number(
      this.configService.get('WEBHOOK_DLQ_TTL_DAYS') ?? 7,
    );
  }

  onModuleInit(): void {
    // Background worker: drain the in-memory queue continuously.
    setInterval(() => void this.drain(), 250);
  }

  /**
   * Resolve the webhooks matching an event, build the signed payload for each,
   * and enqueue one delivery job per webhook. Does not perform any HTTP itself,
   * so it returns quickly and never blocks ingestion.
   */
  async enqueueForEvent(
    event: ContractEvent,
    auditEntry: AuditLog,
  ): Promise<void> {
    const webhooks = await this.webhookRepo.find({
      where: [
        { isActive: true, contract: event.contract, action: event.action },
        { isActive: true, contract: event.contract, action: null as string },
        { isActive: true, contract: null as string, action: null as string },
      ],
    });

    for (const wh of webhooks) {
      if (wh.address && event.address && wh.address !== event.address) continue;
      if (wh.dlqAt) continue;

      const secret = wh.encryptedData
        ? await this.cryptoProvider.decrypt(wh.encryptedData)
        : (wh.secret ?? '');

      const payload = JSON.stringify({
        txHash: event.txHash,
        contract: event.contract,
        action: event.action,
        blockNumber: event.blockNumber,
        data: event.data || {},
        auditId: auditEntry.id,
        chainHash: auditEntry.chainHash,
        timestamp: new Date().toISOString(),
      });

      const correlationId =
        auditEntry.correlationId ?? this.correlationIdStore.get() ?? '';

      this.enqueue({
        webhookId: wh.id,
        url: wh.url,
        secret,
        payload,
        correlationId,
        attempt: 0,
        event: {
          txHash: event.txHash,
          contract: event.contract,
          action: event.action,
          blockNumber: event.blockNumber,
          auditId: auditEntry.id ?? null,
          chainHash: auditEntry.chainHash ?? null,
          participantAddress: (event as any).address ?? null,
        },
      });
    }
  }

  enqueue(job: WebhookJob): void {
    this.queue.push(job);
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (job) {
          await this.process(job);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async process(job: WebhookJob): Promise<void> {
    try {
      const signature = createHmac('sha256', job.secret)
        .update(job.payload)
        .digest('hex');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(job.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': Date.now().toString(),
          [CORRELATION_ID_RESPONSE_HEADER]: job.correlationId,
        },
        body: job.payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        await this.webhookRepo.update(job.webhookId, {
          lastTriggeredAt: new Date(),
          failureCount: 0,
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
        });

        // Event-sourced audit (issue #666): record successful ingestion so
        // projections can consume it. Only delivered events emit — failures
        // go to the DLQ and never produce a ContractEventIngested.
        if (this.eventPublisher) {
          await this.eventPublisher.publish({
            eventType: 'contract_event.ingested',
            aggregateId: `webhook:${job.webhookId}`,
            payload: { ...(job as any).event ?? {}, webhookId: job.webhookId },
            metadata: { deliveredAt: new Date().toISOString() },
          });
        }
        return;
      }

      await this.handleFailure(job, `HTTP ${response.status}`);
    } catch (err) {
      await this.handleFailure(
        job,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Exponential backoff with full jitter. */
  private backoffMs(attempt: number): number {
    const ceiling = this.backoffBaseMs * 2 ** attempt;
    return Math.floor(Math.random() * ceiling);
  }

  private async handleFailure(job: WebhookJob, error: string): Promise<void> {
    const nextAttempt = job.attempt + 1;
    await this.webhookRepo.increment({ id: job.webhookId }, 'failureCount', 1);

    if (nextAttempt >= this.retryMax) {
      await this.webhookRepo.update(job.webhookId, {
        retryCount: nextAttempt,
        nextRetryAt: null,
        dlqAt: new Date(),
        isActive: false,
        lastError: error,
      });
      this.logger.warn(
        `Webhook ${job.webhookId} dead-lettered after ${nextAttempt} attempts: ${error}`,
      );
      return;
    }

    const delay = this.backoffMs(job.attempt);
    await this.webhookRepo.update(job.webhookId, {
      retryCount: nextAttempt,
      nextRetryAt: new Date(Date.now() + delay),
      lastError: error,
    });

    // Re-enqueue the same job (carrying its payload) after the backoff delay.
    setTimeout(() => this.enqueue({ ...job, attempt: nextAttempt }), delay);
  }

  // ---- Dead-letter administration -----------------------------------------

  /** List dead-lettered webhooks (most recent first). */
  listDlq(): Promise<Webhook[]> {
    return this.webhookRepo.find({
      where: { dlqAt: Not(IsNull()) },
      order: { dlqAt: 'DESC' },
    });
  }

  /**
   * Replay a dead-lettered webhook: clear its DLQ/retry state and reactivate it
   * so subsequent matching events are delivered again.
   */
  async replay(id: string): Promise<Webhook | null> {
    const webhook = await this.webhookRepo.findOne({ where: { id } });
    if (!webhook) return null;
    await this.webhookRepo.update(id, {
      dlqAt: null,
      nextRetryAt: null,
      retryCount: 0,
      failureCount: 0,
      isActive: true,
      lastError: null,
    });
    return this.webhookRepo.findOne({ where: { id } });
  }

  /** Purge dead letters older than the configured TTL. */
  async purgeDlq(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - this.dlqTtlDays * 24 * 60 * 60 * 1000);
    const result = await this.webhookRepo.delete({ dlqAt: LessThan(cutoff) });
    return { purged: result.affected ?? 0 };
  }
}
