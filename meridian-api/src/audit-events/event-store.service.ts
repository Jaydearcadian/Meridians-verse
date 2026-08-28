import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from './audit-event.entity';

export interface AppendAuditEvent {
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/**
 * The single write path into the event store (issue #666).
 *
 * Everything audit-related must flow through `append` — direct repository
 * saves to the event store are forbidden outside this service. The event
 * store itself is append-only: this service exposes no update or delete.
 */
@Injectable()
export class EventStoreService {
  private readonly logger = new Logger(EventStoreService.name);

  constructor(
    @InjectRepository(AuditEvent)
    public readonly eventRepository: Repository<AuditEvent>,
  ) {}

  /** Append one event; the DB assigns the monotonic sequenceNo. */
  async append(event: AppendAuditEvent): Promise<AuditEvent> {
    const row = this.eventRepository.create({
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      metadata: event.metadata ?? null,
    } as any);
    const saved = await this.eventRepository.save(row as any);
    return saved as AuditEvent;
  }

  /**
   * Read events in total order, optionally after a sequence (exclusive).
   * Used by projections and replay.
   */
  async readEvents(fromSequenceNo = 0, limit = 1000): Promise<AuditEvent[]> {
    return this.eventRepository
      .createQueryBuilder('e')
      .where('e."sequenceNo" > :from', { from: fromSequenceNo })
      .orderBy('e."sequenceNo"', 'ASC')
      .take(limit)
      .getMany();
  }

  async readEventsByAggregate(
    aggregateId: string,
    fromSequenceNo = 0,
  ): Promise<AuditEvent[]> {
    return this.eventRepository
      .createQueryBuilder('e')
      .where('e."aggregateId" = :aggregateId', { aggregateId })
      .andWhere('e."sequenceNo" > :from', { from: fromSequenceNo })
      .orderBy('e."sequenceNo"', 'ASC')
      .getMany();
  }

  /** Highest assigned sequence number (0 when the store is empty). */
  async headSequenceNo(): Promise<number> {
    const head = await this.eventRepository
      .createQueryBuilder('e')
      .select('MAX(e."sequenceNo")', 'max')
      .getRawOne();
    return Number(head?.max ?? 0);
  }

  async countEvents(): Promise<number> {
    return this.eventRepository.count();
  }
}
