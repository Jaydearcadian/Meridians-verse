import { Injectable, Logger } from '@nestjs/common';
import { EventStoreService, AppendAuditEvent } from './event-store.service';

/**
 * Public façade for writing audit events (issue #666).
 *
 * All audit producers — AuditService, EventsService, future modules — must
 * publish through this class instead of touching the event store or the
 * `audit_logs` table directly. Centralising the write path gives us one
 * place to add metrics, validation, and (later) async fan-out.
 */
@Injectable()
export class EventPublisher {
  private readonly logger = new Logger(EventPublisher.name);

  constructor(private readonly eventStore: EventStoreService) {}

  async publish(event: AppendAuditEvent) {
    if (!event.eventType || !event.aggregateId) {
      throw new Error('eventType and aggregateId are required');
    }
    const saved = await this.eventStore.append(event);
    this.logger.debug(
      JSON.stringify({
        msg: 'event.published',
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        sequenceNo: saved.sequenceNo,
      }),
    );
    return saved;
  }
}
