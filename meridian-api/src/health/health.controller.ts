import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public/public.decorator';
import { PoolMonitoringService } from './pool-monitoring.service';

@SkipThrottle()
@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private poolMonitoring: PoolMonitoringService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Check the health of the application and its dependencies',
  })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.95,
        }),
      () => this.checkPoolHealth(),
    ]);
  }

  /**
   * Check database connection pool health
   * Fails if waiting connections exceed threshold (default: 10)
   */
  checkPoolHealth() {
    const metrics = this.poolMonitoring.getCurrentMetrics();
    const threshold = 10;

    if (metrics.waitingConnections >= threshold) {
      throw new Error(
        `Connection pool unhealthy: ${metrics.waitingConnections} clients waiting for connections (threshold: ${threshold})`,
      );
    }

    return {
      database_pool: {
        status: 'up' as const,
        details: {
          activeConnections: metrics.activeConnections,
          idleConnections: metrics.idleConnections,
          waitingConnections: metrics.waitingConnections,
          saturation: (metrics.saturation * 100).toFixed(1) + '%',
        },
      },
    };
  }
}
