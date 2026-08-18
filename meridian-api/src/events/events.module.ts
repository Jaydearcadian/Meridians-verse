import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EventsService } from './events.service';
import { AuditController } from './audit.controller';
import { WebhookController } from './webhook.controller';
import { Webhook } from './webhook.entity';
import { LeaderboardProofModule } from '../leaderboard/leaderboard-proof.module';
import { CryptoModule } from 'src/crypto/crypto.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    AuditModule,
    LeaderboardProofModule,
    CryptoModule,
  ],
  providers: [EventsService],
  controllers: [AuditController, WebhookController],
  exports: [EventsService],
})
export class EventsModule {}
