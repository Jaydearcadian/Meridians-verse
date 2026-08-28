import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  ProjectionEngine,
} from '../audit-events/projection-engine.service';
import { AuditLogProjection } from '../audit-events/audit-log.projection';

@ApiTags('Audit')
@Controller('audit')
export class AuditReplayController {
  constructor(
    private readonly engine: ProjectionEngine,
    private readonly auditLogProjection: AuditLogProjection,
  ) {}

  /**
   * Rebuild projections from the event store (issue #666).
   *
   * Admin-only: guarded by RequireRoles(ADMIN) metadata evaluated by the
   * global RbacGuard. Body may specify `fromSequence` or `fromTimestamp`
   * per the issue; with no body, replay resumes from each projection's
   * latest snapshot.
   */
  @Post('replay')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rebuild audit projections from the event store (admin only)' })
  async replay(
    @Req() req: Request,
    @Body()
    body?: {
      projectionName?: string;
      fromSequence?: number;
      fromTimestamp?: string;
      forceFullReplay?: boolean;
    },
  ) {
    const user = (req as any).user as
      | { sub?: number | string; role?: string; permissions?: string[] }
      | undefined;
    const role = String(user?.role ?? '').toUpperCase();
    const isAdmin =
      role === 'ADMIN' || (user?.permissions ?? []).includes('admin');
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    // Full rebuild: clear projected rows so replay starts clean when forced.
    if (body?.forceFullReplay || body?.fromSequence != null || body?.fromTimestamp != null) {
      await this.auditLogProjection.clear();
    }

    const targets = body?.projectionName
      ? [body.projectionName]
      : this.engine.registeredProjections();

    const results: Record<string, unknown> = {};
    for (const name of targets) {
      results[name] = await this.engine.replayProjection(name, {
        force: Boolean(body?.forceFullReplay),
      });
    }

    return {
      message: 'Replay complete',
      results,
    };
  }
}
