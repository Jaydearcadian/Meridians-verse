import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EventsService } from './events.service';
import { WebhookQueueService } from './webhook-queue.service';
import { AuditController } from './audit.controller';
import { WebhookController } from './webhook.controller';
import { WebhookAdminController } from './webhook-admin.controller';
import { Webhook } from './webhook.entity';
import { LeaderboardProofModule } from '../leaderboard/leaderboard-proof.module';
import { CryptoModule } from 'src/crypto/crypto.module';
import { CorrelationModule } from '../common/correlation/correlation.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Webhook]),
    AuditModule,
    LeaderboardProofModule,
    CryptoModule,
    CorrelationModule,
  ],
  providers: [EventsService, WebhookQueueService],
  controllers: [AuditController, WebhookController, WebhookAdminController],
  exports: [EventsService],
})
export class EventsModule {}
