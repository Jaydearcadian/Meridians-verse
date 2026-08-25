jest.mock('../../users/user.entity', () => ({ User: class User {} }), {
  virtual: true,
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LockoutService } from './lockout.service';
import { User } from '../../users/user.entity';

describe('LockoutService', () => {
  let service: LockoutService;
  let usersRepo: {
    findOneBy: jest.Mock;
    update: jest.Mock;
  };

  const defaultConfig = {
    LOCKOUT_MAX_ATTEMPTS: 5,
    LOCKOUT_BASE_SECONDS: 300,
    LOCKOUT_MAX_SECONDS: 86400,
    LOCKOUT_IP_MAX_ATTEMPTS: 20,
    LOCKOUT_IP_SECONDS: 3600,
    LOCKOUT_TTL_SECONDS: 86400,
  };

  function buildConfig(overrides: Record<string, unknown> = {}) {
    return {
      get: jest.fn((key: string, fallback?: unknown) => {
        return overrides[key] ?? defaultConfig[key] ?? fallback;
      }),
    } as unknown as ConfigService;
  }

  beforeEach(async () => {
    usersRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LockoutService,
        { provide: ConfigService, useFactory: () => buildConfig() },
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();

    service = module.get(LockoutService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------- Threshold tests

  it('does not lock the account before reaching the threshold', async () => {
    for (let i = 0; i < 4; i++) {
      const result = await service.recordFailedAttempt(1, '10.0.0.1');
      expect(result.accountLocked).toBe(false);
    }

    const state = await service.getAccountState(1);
    expect(state.count).toBe(4);
  });

  it('locks the account after reaching the threshold', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await service.recordFailedAttempt(1, '10.0.0.1');
      if (i < 4) {
        expect(result.accountLocked).toBe(false);
      } else {
        expect(result.accountLocked).toBe(true);
        expect(result.lockedUntil).toBeInstanceOf(Date);
      }
    }

    const isLocked = await service.isAccountLocked(1);
    expect(isLocked).toBe(true);
  });

  it('persists the lockout to the database', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(1, '10.0.0.1');
    }

    expect(usersRepo.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        failedLoginCount: 5,
        lockedUntil: expect.any(Date),
        lastFailedLoginAt: expect.any(Date),
      }),
    );
  });

  it('returns false for isAccountLocked when not locked', async () => {
    await service.recordFailedAttempt(1, '10.0.0.1');
    expect(await service.isAccountLocked(1)).toBe(false);
  });

  // ---------------------------------------------------- Exponential backoff

  describe('exponential backoff', () => {
    it('doubles the lockout duration on each lockout cycle', async () => {
      // Simulate that this is the first lockout (totalLockouts = 0)
      usersRepo.findOneBy.mockResolvedValue({ id: 1, totalLockouts: 0 } as any);

      // First lockout: 300s * 2^(1-1) = 300s
      for (let i = 0; i < 5; i++) {
        await service.recordFailedAttempt(1, '10.0.0.1');
      }
      let state = await service.getAccountState(1);
      const firstLockedUntil = state.lockedUntil!;
      const firstDuration = firstLockedUntil - Date.now();

      // Simulate that totalLockouts = 1 (first lockout already happened)
      usersRepo.findOneBy.mockResolvedValue({ id: 1, totalLockouts: 1 } as any);

      // Unlock and fail again to trigger second lockout
      await service.adminUnlock(1);
      for (let i = 0; i < 5; i++) {
        await service.recordFailedAttempt(1, '10.0.0.1');
      }
      state = await service.getAccountState(1);
      const secondLockedUntil = state.lockedUntil!;
      const secondDuration = secondLockedUntil - Date.now();

      // Second lockout: 300s * 2^(2-1) = 600s, should be roughly 2x the first
      expect(secondDuration).toBeGreaterThan(firstDuration * 1.5);
    });

    it('caps lockout duration at maxLockoutSeconds', async () => {
      // Simulate many lockout cycles to hit the cap
      await service.adminUnlock(1);
      for (let cycle = 0; cycle < 20; cycle++) {
        for (let i = 0; i < 5; i++) {
          await service.recordFailedAttempt(1, '10.0.0.1');
        }
        await service.adminUnlock(1);
      }

      const state = await service.getAccountState(1);
      if (state.lockedUntil) {
        const duration = (state.lockedUntil - Date.now()) / 1000;
        expect(duration).toBeLessThanOrEqual(
          defaultConfig.LOCKOUT_MAX_SECONDS + 5,
        );
      }
    });
  });

  // ---------------------------------------------------------- IP lockout

  it('does not lock the IP before reaching the IP threshold', async () => {
    for (let i = 0; i < 19; i++) {
      const result = await service.recordFailedAttempt(100 + i, '10.0.0.2');
      expect(result.ipLocked).toBe(false);
    }
  });

  it('locks the IP after reaching the IP threshold', async () => {
    for (let i = 0; i < 20; i++) {
      const result = await service.recordFailedAttempt(100 + i, '10.0.0.3');
      if (i < 19) {
        expect(result.ipLocked).toBe(false);
      } else {
        expect(result.ipLocked).toBe(true);
      }
    }

    expect(await service.isIpLocked('10.0.0.3')).toBe(true);
  });

  it('returns false for isIpLocked when IP is not locked', async () => {
    await service.recordFailedAttempt(1, '10.0.0.4');
    expect(await service.isIpLocked('10.0.0.4')).toBe(false);
  });

  // ------------------------------------------------------- Admin unlock

  describe('adminUnlock', () => {
    it('clears the account lockout state but preserves totalLockouts', async () => {
      // Simulate a user with 1 prior lockout
      usersRepo.findOneBy.mockResolvedValue({ id: 1, totalLockouts: 1 } as any);

      // Lock the account
      for (let i = 0; i < 5; i++) {
        await service.recordFailedAttempt(1, '10.0.0.1');
      }
      expect(await service.isAccountLocked(1)).toBe(true);

      // Admin unlock
      await service.adminUnlock(1);

      expect(await service.isAccountLocked(1)).toBe(false);
      const state = await service.getAccountState(1);
      expect(state.count).toBe(0);
      expect(state.lockedUntil).toBeNull();

      // DB should be cleared, but totalLockouts is preserved
      expect(usersRepo.update).toHaveBeenCalledWith(1, {
        failedLoginCount: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      });
    });

    it('clears all IP locks', async () => {
      // Lock multiple IPs
      for (let i = 0; i < 20; i++) {
        await service.recordFailedAttempt(100 + i, '10.0.0.5');
      }
      expect(await service.isIpLocked('10.0.0.5')).toBe(true);

      await service.adminUnlock(1);
      // IP lockout should be cleared too (all IPs cleared)
    });
  });

  // ------------------------------------------------------ Success clears

  describe('clearOnSuccess', () => {
    it('clears failure counters on successful sign-in', async () => {
      // Accumulate some failures
      for (let i = 0; i < 3; i++) {
        await service.recordFailedAttempt(1, '10.0.0.1');
      }

      let state = await service.getAccountState(1);
      expect(state.count).toBe(3);

      await service.clearOnSuccess(1, '10.0.0.1');

      state = await service.getAccountState(1);
      expect(state.count).toBe(0);
      expect(state.lockedUntil).toBeNull();

      // DB should be cleared
      expect(usersRepo.update).toHaveBeenCalledWith(1, {
        failedLoginCount: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      });
    });
  });
});
