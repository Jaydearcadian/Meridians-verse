import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';
import { CorrelationModule } from '../common/correlation/correlation.module';
import { AuditEventsModule } from 'src/audit-events/audit-events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    CorrelationModule,
    AuditEventsModule,
  ],
  providers: [AuditService],
  exports: [AuditService, TypeOrmModule],
})
export class AuditModule {}
