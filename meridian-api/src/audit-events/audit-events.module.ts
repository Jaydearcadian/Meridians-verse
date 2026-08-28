import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent } from './audit-event.entity';
import { ProjectionCheckpoint } from './projection-checkpoint.entity';
import { ProjectionSnapshot } from './projection-snapshot.entity';
import { EventStoreService } from './event-store.service';
import { EventPublisher } from './event-publisher.service';
import { ProjectionCheckpointService } from './projection-checkpoint.service';
import { SnapshotService } from './snapshot.service';
import { ProjectionEngine } from './projection-engine.service';
import { AuditLogProjection } from './audit-log.projection';
import { LeaderboardProjection } from './leaderboard.projection';
import { EventStoreMetricsService } from './event-store-metrics.service';
import { AuditLog } from '../audit/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEvent,
      ProjectionCheckpoint,
      ProjectionSnapshot,
      AuditLog,
    ]),
  ],
  providers: [
    EventStoreService,
    EventPublisher,
    ProjectionCheckpointService,
    SnapshotService,
    ProjectionEngine,
    AuditLogProjection,
    LeaderboardProjection,
    EventStoreMetricsService,
  ],
  exports: [
    EventStoreService,
    EventPublisher,
    ProjectionEngine,
    AuditLogProjection,
    LeaderboardProjection,
    SnapshotService,
    ProjectionCheckpointService,
  ],
})
export class AuditEventsModule {}
