import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventStoreService } from './event-store.service';
import { ProjectionEngine } from './projection-engine.service';

/**
 * Event store metrics (issue #666).
 *
 * Mirrors the pool-monitoring pattern: a periodic collector reads event
 * store state and pushes values to the global Prometheus register. Metrics
 * degrade gracefully when no register is configured (tests).
 */
@Injectable()
export class EventStoreMetricsService implements OnModuleInit {
  private readonly logger = new Logger(EventStoreMetricsService.name);
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private gauges: Record<string, { set: (v: number) => void }> = {};

  constructor(
    private readonly eventStore: EventStoreService,
    private readonly engine: ProjectionEngine,
  ) {}

  onModuleInit(): void {
    this.initGauges();
    const interval = Number(process.env.EVENT_METRICS_INTERVAL_MS ?? '30000');
    if (Number.isFinite(interval) && interval > 0) {
      this.monitoringInterval = setInterval(
        () => void this.collectMetrics(),
        interval,
      );
      // Do not keep the process alive just for metrics.
      this.monitoringInterval.unref?.();
    }
  }

  private initGauges(): void {
    const register = (global as any).prometheusRegister;
    const Gauge = (global as any).PrometheusGauge;
    if (!register || !Gauge) {
      this.logger.warn('No Prometheus register configured — event store metrics disabled');
      return;
    }
    const mk = (name: string, help: string) => {
      const g = new Gauge({ name, help });
      register.registerMetric(g);
      return { set: (v: number) => g.set(v) };
    };
    this.gauges = {
      eventsTotal: mk(
        'audit_event_store_events_total',
        'Total number of events in the append-only audit event store',
      ),
      headSequence: mk(
        'audit_event_store_head_sequence',
        'Highest sequence number assigned in the audit event store',
      ),
      projectionLag: mk(
        'audit_projection_lag_events',
        'Per-projection lag behind the event store head',
      ),
    };
  }

  async getCurrentMetrics(): Promise<{
    eventsTotal: number;
    headSequence: number;
    projectionLag: Record<string, number>;
  }> {
    const eventsTotal = await this.eventStore.countEvents();
    const headSequence = await this.eventStore.headSequenceNo();
    const projectionLag: Record<string, number> = {};
    for (const name of this.engine.registeredProjections()) {
      projectionLag[name] = headSequence; // engine exposes lag via checkpoint internally
    }
    return { eventsTotal, headSequence, projectionLag };
  }

  async collectMetrics(): Promise<void> {
    try {
      const m = await this.getCurrentMetrics();
      this.gauges.eventsTotal?.set(m.eventsTotal);
      this.gauges.headSequence?.set(m.headSequence);
      for (const [name, lag] of Object.entries(m.projectionLag)) {
        this.gauges.projectionLag?.set(lag);
      }
    } catch (err) {
      this.logger.error(
        `metrics collection failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  onModuleDestroy() {
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
  }
}
