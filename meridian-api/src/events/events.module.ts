import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EventsService } from './events.service';
import { WebhookQueueService } from './webhook-queue.service';
import { AuditController } from './audit.controller';
import { AuditReplayController } from '../audit/audit-replay.controller';
import { WebhookController } from './webhook.controller';
import { WebhookAdminController } from './webhook-admin.controller';
import { Webhook } from './webhook.entity';
import { LeaderboardProofModule } from '../leaderboard/leaderboard-proof.module';
import { CryptoModule } from 'src/crypto/crypto.module';
import { CorrelationModule } from '../common/correlation/correlation.module';
import { AuditEventsModule } from 'src/audit-events/audit-events.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Webhook]),
    AuditModule,
    LeaderboardProofModule,
    CryptoModule,
    CorrelationModule,
    AuditEventsModule,
  ],
  providers: [EventsService, WebhookQueueService],
  controllers: [
    AuditController,
    AuditReplayController,
    WebhookController,
    WebhookAdminController,
  ],
  exports: [EventsService],
})
export class EventsModule {}
