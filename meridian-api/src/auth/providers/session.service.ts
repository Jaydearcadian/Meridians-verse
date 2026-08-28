import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { AuditService } from 'src/audit/audit.service';

/**
 * Shape of a session as exposed to the user via GET /auth/sessions.
 * Never leaks token hashes or encrypted envelopes.
 */
export interface SessionView {
  id: string;
  jti: string;
  deviceName: string | null;
  ipAddress: string | null;
  location: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

/**
 * Concurrent session management & device tracking (issue #665).
 *
 * Owns:
 *  - listing a user's active sessions (self-service);
 *  - revoking one session by id with an ownership check;
 *  - enforcing MAX_CONCURRENT_SESSIONS on session creation
 *    (policy: evict the least-recently-used active session).
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,

    private readonly auditService: AuditService,
  ) {}

  /**
   * Maximum concurrent active sessions per user. Configurable via env
   * (`MAX_CONCURRENT_SESSIONS`); defaults to 5.
   */
  get maxConcurrentSessions(): number {
    const parsed = Number(process.env.MAX_CONCURRENT_SESSIONS ?? '');
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    // Conservative default when no env override is present.
    return 5;
  }

  /** Active = not revoked and not expired. */
  async listActiveSessions(userId: number): Promise<SessionView[]> {
    const tokens = await this.refreshTokenRepository.find({
      where: [
        { userId, revokedAt: null as any },
      ],
      order: { lastUsedAt: 'DESC' },
    });

    const now = new Date();
    return tokens
      .filter((t) => t.expiresAt > now)
      .map((t) => ({
        id: t.id,
        jti: t.jti,
        deviceName: t.deviceName,
        ipAddress: t.ipAddress,
        location: t.location,
        userAgent: t.userAgent,
        createdAt: (t as any).createdAt ?? null,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
      }));
  }

  /**
   * Revoke one of the user's own sessions by primary-key id.
   * Throws ForbiddenException when the session belongs to another user —
   * self-service only.
   */
  async revokeSession(userId: number, sessionId: string): Promise<void> {
    const token = await this.refreshTokenRepository.findOne({
      where: { id: sessionId },
    });

    if (!token || token.revokedAt) {
      // Treat unknown/already-revoked as not found for the caller.
      throw new ForbiddenException('Session not found');
    }

    if (token.userId !== userId) {
      throw new ForbiddenException('Not your session');
    }

    await this.refreshTokenRepository.update(
      { id: sessionId },
      { revokedAt: new Date() },
    );

    await this.safeAudit(userId, 'REFRESH_TOKEN', String(sessionId), 'DELETE', {
      newValues: {
        revokedAt: new Date().toISOString(),
        deviceName: token.deviceName ?? null,
        action: 'session-revoked',
      },
    });
  }

  /**
   * Enforce the concurrent-session ceiling after a new session row is saved.
   * Policy (documented in evaluation/EVALUATION_TRUTH.md): evict the
   * least-recently-used active sessions beyond the cap.
   *
   * Returns the jtis of evicted sessions (for audit/tests).
   */
  async enforceSessionLimit(userId: number): Promise<string[]> {
    const max = this.maxConcurrentSessions;

    const active = await this.refreshTokenRepository.find({
      where: { userId, revokedAt: null as any },
    });

    const now = new Date();
    const live = active.filter((t) => t.expiresAt > now);
    if (live.length <= max) return [];

    // LRU: oldest lastUsedAt first; never-evicted timestamps sort oldest.
    live.sort(
      (a, b) =>
        (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0),
    );

    const toEvict = live.slice(0, live.length - max);
    const evictedJtis: string[] = [];

    for (const token of toEvict) {
      await this.refreshTokenRepository.update(
        { id: token.id },
        { revokedAt: now },
      );
      evictedJtis.push(token.jti);
    }

    if (evictedJtis.length > 0) {
      await this.safeAudit(
        userId,
        'REFRESH_TOKEN',
        userId.toString(),
        'UPDATE',
        {
          newValues: {
            action: 'sessions-evicted',
            count: evictedJtis.length,
            reason: 'MAX_CONCURRENT_SESSIONS',
          },
        },
      );
    }

    return evictedJtis;
  }

  /**
   * Audit logging must never break the auth flow: wrap and swallow.
   */
  private async safeAudit(
    performedById: number,
    entityName: string,
    entityId: string,
    action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
    extra: { newValues?: Record<string, unknown>; ipAddress?: string | null },
  ): Promise<void> {
    try {
      await this.auditService.log({
        entityName,
        entityId,
        action: action as never,
        performedById,
        newValues: extra.newValues ?? null,
        ipAddress: extra.ipAddress ?? null,
      });
    } catch {
      // Swallow: audit is best-effort for session events.
    }
  }
}
