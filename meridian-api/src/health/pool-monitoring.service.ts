import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Gauge } from 'prom-client';

@Injectable()
export class PoolMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolMonitoringService.name);
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  // Prometheus metrics for connection pool monitoring
  private readonly activeConnectionsGauge: Gauge<string>;
  private readonly idleConnectionsGauge: Gauge<string>;
  private readonly waitingConnectionsGauge: Gauge<string>;
  private readonly poolSaturationGauge: Gauge<string>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    // Initialize Prometheus gauges with proper labels
    const register = (global as any).prometheusRegister;

    this.activeConnectionsGauge = new Gauge({
      name: 'typeorm_pool_active_connections',
      help: 'Number of active connections in the TypeORM connection pool',
      registers: [register],
    });

    this.idleConnectionsGauge = new Gauge({
      name: 'typeorm_pool_idle_connections',
      help: 'Number of idle connections in the TypeORM connection pool',
      registers: [register],
    });

    this.waitingConnectionsGauge = new Gauge({
      name: 'typeorm_pool_waiting_connections',
      help: 'Number of clients waiting for a connection from the pool',
      registers: [register],
    });

    this.poolSaturationGauge = new Gauge({
      name: 'typeorm_pool_saturation',
      help: 'Connection pool saturation ratio (active / total connections)',
      registers: [register],
    });
  }

  onModuleInit(): void {
    // Start monitoring at 5-second intervals
    this.monitoringInterval = setInterval(() => this.collectMetrics(), 5000);
    this.logger.log('Pool monitoring service initialized');
  }

  onModuleDestroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.logger.log('Pool monitoring service stopped');
  }

  private async collectMetrics(): Promise<void> {
    try {
      const driver = this.dataSource.driver;
      const pool = (driver as any).pool;

      if (!pool) {
        this.logger.warn('Connection pool not available for monitoring');
        return;
      }

      // Extract pool metrics from PostgreSQL driver
      const totalConnections = pool.totalCount || 0;
      const idleConnections = pool.idleCount || 0;
      const waitingConnections = pool.waitingCount || 0;
      const activeConnections = totalConnections - idleConnections;

      // Calculate saturation ratio
      const saturation =
        totalConnections > 0 ? activeConnections / totalConnections : 0;

      // Update Prometheus gauges
      this.activeConnectionsGauge.set(activeConnections);
      this.idleConnectionsGauge.set(idleConnections);
      this.waitingConnectionsGauge.set(waitingConnections);
      this.poolSaturationGauge.set(saturation);

      this.logger.debug(
        `Pool metrics - Active: ${activeConnections}, Idle: ${idleConnections}, Waiting: ${waitingConnections}, Saturation: ${(saturation * 100).toFixed(1)}%`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to collect pool metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Get current pool metrics synchronously (for health checks)
  getCurrentMetrics(): {
    activeConnections: number;
    idleConnections: number;
    waitingConnections: number;
    saturation: number;
  } {
    try {
      const driver = this.dataSource.driver;
      const pool = (driver as any).pool;

      if (!pool) {
        return {
          activeConnections: 0,
          idleConnections: 0,
          waitingConnections: 0,
          saturation: 0,
        };
      }

      const totalConnections = pool.totalCount || 0;
      const idleConnections = pool.idleCount || 0;
      const waitingConnections = pool.waitingCount || 0;
      const activeConnections = totalConnections - idleConnections;
      const saturation =
        totalConnections > 0 ? activeConnections / totalConnections : 0;

      return {
        activeConnections,
        idleConnections,
        waitingConnections,
        saturation,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get current pool metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        activeConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        saturation: 0,
      };
    }
  }

  // Check if pool is healthy based on waiting connections threshold
  isPoolHealthy(threshold: number = 10): boolean {
    const metrics = this.getCurrentMetrics();
    return metrics.waitingConnections < threshold;
  }
}
