import { ForbiddenException } from '@nestjs/common';
import { SessionService } from './session.service';

describe('SessionService (issue #665)', () => {
  let service: SessionService;
  let refreshTokenRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  const mkToken = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'tok-1',
    jti: 'jti-1',
    userId: 1,
    deviceName: 'iPhone',
    ipAddress: '10.0.0.1',
    location: 'Lagos',
    userAgent: 'UA',
    lastUsedAt: new Date('2026-01-02'),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-01'));
    refreshTokenRepository = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      update: jest.fn(async () => undefined),
    };
    auditService = { log: jest.fn(async () => undefined) };
    delete process.env.MAX_CONCURRENT_SESSIONS;
    service = new SessionService(
      refreshTokenRepository as any,
      auditService as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('maxConcurrentSessions', () => {
    it('defaults to 5', () => {
      expect(service.maxConcurrentSessions).toBe(5);
    });
    it('honours MAX_CONCURRENT_SESSIONS env override', () => {
      process.env.MAX_CONCURRENT_SESSIONS = '3';
      expect(service.maxConcurrentSessions).toBe(3);
    });
  });

  describe('listActiveSessions', () => {
    it('returns only non-revoked, non-expired tokens and hides secrets', async () => {
      refreshTokenRepository.find.mockResolvedValue([
        mkToken(),
        mkToken({ id: 'tok-2', jti: 'jti-2' }),
        mkToken({ id: 'tok-expired', expiresAt: new Date('2025-01-01') }),
      ]);

      const sessions = await service.listActiveSessions(1);

      expect(sessions).toHaveLength(2);
      for (const s of sessions) {
        expect(s).not.toHaveProperty('tokenHash');
        expect(s).not.toHaveProperty('encryptedData');
        expect(s.deviceName).toBe('iPhone');
        expect(s.lastUsedAt).toBeTruthy();
      }
    });
  });

  describe('revokeSession', () => {
    it("revokes one of the user's own sessions and audits", async () => {
      const token = mkToken();
      refreshTokenRepository.findOne.mockResolvedValue(token);

      await service.revokeSession(1, 'tok-1');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { id: 'tok-1' },
        { revokedAt: expect.any(Date) },
      );
      expect(auditService.log).toHaveBeenCalled();
    });

    it('rejects revoking another user\u2019s session (ownership check)', async () => {
      const token = mkToken({ userId: 999 });
      refreshTokenRepository.findOne.mockResolvedValue(token);

      await expect(service.revokeSession(1, 'tok-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });

    it('rejects unknown or already-revoked session ids', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);
      await expect(service.revokeSession(1, 'nope')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      refreshTokenRepository.findOne.mockResolvedValue(
        mkToken({ revokedAt: new Date() }),
      );
      await expect(service.revokeSession(1, 'tok-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('enforceSessionLimit (MAX_CONCURRENT_SESSIONS)', () => {
    it('evicts least-recently-used sessions beyond the ceiling', async () => {
      process.env.MAX_CONCURRENT_SESSIONS = '3';
      const active = [
        mkToken({ id: 'a', jti: 'ja', lastUsedAt: new Date('2026-01-01') }), // oldest → evicted
        mkToken({ id: 'b', jti: 'jb', lastUsedAt: new Date('2026-01-02') }),
        mkToken({ id: 'c', jti: 'jc', lastUsedAt: new Date('2026-01-03') }),
        mkToken({ id: 'd', jti: 'jd', lastUsedAt: new Date('2026-01-04') }),
      ];
      refreshTokenRepository.find.mockResolvedValue(active);

      const evicted = await service.enforceSessionLimit(1);

      // 4 live sessions vs cap 3 → exactly the single LRU session goes.
      expect(evicted).toEqual(['ja']);
      expect(refreshTokenRepository.update).toHaveBeenCalledTimes(1);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { id: 'a' },
        { revokedAt: expect.any(Date) },
      );
      expect(auditService.log).toHaveBeenCalled();
    });

    it('is a no-op when the user is within the ceiling (mutation guard)', async () => {
      refreshTokenRepository.find.mockResolvedValue([mkToken()]);
      const evicted = await service.enforceSessionLimit(1);
      expect(evicted).toEqual([]);
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });

    it('ignores already-expired sessions when counting', async () => {
      process.env.MAX_CONCURRENT_SESSIONS = '1';
      refreshTokenRepository.find.mockResolvedValue([
        mkToken(),
        mkToken({ id: 'dead', expiresAt: new Date('2020-01-01') }),
      ]);
      const evicted = await service.enforceSessionLimit(1);
      expect(evicted).toEqual([]);
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });
  });
});
