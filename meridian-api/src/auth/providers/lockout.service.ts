import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { REDIS_CLIENT } from '../../rate-limit/rate-limit.constants';
import { User } from '../../users/user.entity';
import type Redis from 'ioredis';

/**
 * Account lockout configuration read from the environment.
 */
export interface LockoutConfig {
  /** Max consecutive failed attempts before the account is locked. */
  maxAttempts: number;
  /** Base lockout duration in seconds (doubles with each lockout). */
  baseLockoutSeconds: number;
  /** Maximum lockout duration in seconds (caps the exponential curve). */
  maxLockoutSeconds: number;
  /** Max failures tracked per IP before that IP is also locked. */
  ipMaxAttempts: number;
  /** Lockout duration for an IP in seconds. */
  ipLockoutSeconds: number;
  /** How long failure records persist in Redis (seconds). */
  ttlSeconds: number;
}

/**
 * In-memory snapshot of what Redis holds for one key.
 */
interface LockoutSnapshot {
  count: number;
  lockedUntil: number | null;
}

/**
 * Account lockout service (issue #650).
 *
 * Strategy:
 *  1. Every failed sign-in increments a per-account counter in Redis
 *     (`lockout:account:<userId>`) and a per-IP counter
 *     (`lockout:ip:<ip>`).
 *  2. If the per-account count reaches the threshold, the account is
 *     locked for `baseLockoutSeconds * 2^(lockouts - 1)` seconds, capped
 *     at `maxLockoutSeconds`.  The lockout timestamp is persisted on the
 *     `users` row so it survives a Redis flush and is visible to admins.
 *  3. Per-IP lockout blocks *all* sign-in attempts from that IP (defending
 *     against credential-stuffing from a single origin).
 *  4. Successful sign-in clears both counters.
 *  5. Admin unlock clears the DB columns *and* the Redis keys.
 */
@Injectable()
export class LockoutService {
  private readonly logger = new Logger(LockoutService.name);
  private readonly config: LockoutConfig;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    this.config = {
      maxAttempts: this.configService.get<number>('LOCKOUT_MAX_ATTEMPTS', 5),
      baseLockoutSeconds: this.configService.get<number>('LOCKOUT_BASE_SECONDS', 300),
      maxLockoutSeconds: this.configService.get<number>('LOCKOUT_MAX_SECONDS', 86400),
      ipMaxAttempts: this.configService.get<number>('LOCKOUT_IP_MAX_ATTEMPTS', 20),
      ipLockoutSeconds: this.configService.get<number>('LOCKOUT_IP_SECONDS', 3600),
      ttlSeconds: this.configService.get<number>('LOCKOUT_TTL_SECONDS', 86400),
    };
  }

  // ------------------------------------------------------------------ Redis
  // We support an in-memory Map fallback when Redis is unavailable so
  // the lockout logic still works in single-instance dev / CI.

  private memoryStore = new Map<string, LockoutSnapshot>();

  private async redisGet(key: string): Promise<LockoutSnapshot | null> {
    if (this.redis) {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as LockoutSnapshot;
      } catch {
        return null;
      }
    }
    return this.memoryStore.get(key) ?? null;
  }

  private async redisSet(key: string, value: LockoutSnapshot, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      this.memoryStore.set(key, value);
      // In-memory TTL approximation: purge after TTL.
      setTimeout(() => this.memoryStore.delete(key), ttlSeconds * 1000).unref();
    }
  }

  private async redisDel(key: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(key);
    } else {
      this.memoryStore.delete(key);
    }
  }

  // --------------------------------------------------------- Public helpers

  private accountKey(userId: number): string {
    return `lockout:account:${userId}`;
  }

  private ipKey(ip: string): string {
    return `lockout:ip:${ip}`;
  }

  /**
   * Returns the current lockout state for a user (for testing / admin UI).
   */
  async getAccountState(userId: number): Promise<LockoutSnapshot> {
    const snapshot = await this.redisGet(this.accountKey(userId));
    return snapshot ?? { count: 0, lockedUntil: null };
  }

  /**
   * Returns the current lockout state for an IP address.
   */
  async getIpState(ip: string): Promise<LockoutSnapshot> {
    const snapshot = await this.redisGet(this.ipKey(ip));
    return snapshot ?? { count: 0, lockedUntil: null };
  }

  /**
   * Check whether the account is currently locked.
   * Considers both the DB-persisted `lockedUntil` and the Redis key
   * (the more up-to-date source while the TTL hasn't expired).
   */
  async isAccountLocked(userId: number): Promise<boolean> {
    // Fast path: check Redis
    const snapshot = await this.redisGet(this.accountKey(userId));
    if (snapshot?.lockedUntil && snapshot.lockedUntil > Date.now()) {
      return true;
    }

    // Slow path: check DB (survives Redis flush)
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return true;
    }

    return false;
  }

  /**
   * Check whether an IP is currently locked out.
   */
  async isIpLocked(ip: string): Promise<boolean> {
    const snapshot = await this.redisGet(this.ipKey(ip));
    return !!snapshot?.lockedUntil && snapshot.lockedUntil > Date.now();
  }

  /**
   * Record a failed login attempt for both the account and the IP.
   *
   * Returns `{ accountLocked: boolean, ipLocked: boolean, lockedUntil: Date | null }`
   * so the caller can decide what to do (fire audit / email / webhook).
   */
  async recordFailedAttempt(
    userId: number,
    ip: string,
  ): Promise<{ accountLocked: boolean; ipLocked: boolean; lockedUntil: Date | null }> {
    const { maxAttempts, baseLockoutSeconds, maxLockoutSeconds, ipMaxAttempts, ipLockoutSeconds, ttlSeconds } = this.config;

    // --- Per-account ---
    const acctSnapshot = await this.redisGet(this.accountKey(userId));
    let acctCount = (acctSnapshot?.count ?? 0) + 1;
    let acctLockedUntil: number | null = null;
    let accountLocked = false;

    if (acctCount >= maxAttempts) {
      // Fetch the total historical lockout count from DB for the backoff
      // exponent.  This is NOT reset on unlock so each cycle increases.
      const user = await this.usersRepository.findOneBy({ id: userId });
      const totalLockouts = (user?.totalLockouts ?? 0) + 1;
      const duration = Math.min(
        baseLockoutSeconds * Math.pow(2, totalLockouts - 1),
        maxLockoutSeconds,
      );
      acctLockedUntil = Date.now() + duration * 1000;
      accountLocked = true;

      // Persist to DB so the admin UI and throttle guard can see it
      await this.usersRepository.update(userId, {
        failedLoginCount: acctCount,
        totalLockouts,
        lockedUntil: new Date(acctLockedUntil),
        lastFailedLoginAt: new Date(),
      });
    }

    await this.redisSet(
      this.accountKey(userId),
      { count: acctCount, lockedUntil: acctLockedUntil },
      ttlSeconds,
    );

    // Always update the DB counter for the admin UI
    if (!accountLocked) {
      await this.usersRepository.update(userId, {
        failedLoginCount: acctCount,
        lastFailedLoginAt: new Date(),
      });
    }

    // --- Per-IP ---
    const ipSnapshot = await this.redisGet(this.ipKey(ip));
    let ipCount = (ipSnapshot?.count ?? 0) + 1;
    let ipLockedUntil: number | null = null;
    let ipLocked = false;

    if (ipCount >= ipMaxAttempts) {
      ipLockedUntil = Date.now() + ipLockoutSeconds * 1000;
      ipLocked = true;
    }

    await this.redisSet(
      this.ipKey(ip),
      { count: ipCount, lockedUntil: ipLockedUntil },
      ttlSeconds,
    );

    return {
      accountLocked,
      ipLocked,
      lockedUntil: acctLockedUntil ? new Date(acctLockedUntil) : null,
    };
  }

  /**
   * Reset counters on successful sign-in.
   */
  async clearOnSuccess(userId: number, ip: string): Promise<void> {
    await this.redisDel(this.accountKey(userId));
    await this.redisDel(this.ipKey(ip));
    await this.usersRepository.update(userId, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
    });
  }

  /**
   * Admin unlock: clears both Redis and DB state.
   */
  async adminUnlock(userId: number): Promise<void> {
    await this.redisDel(this.accountKey(userId));
    // Clear all IP locks too (we don't know which IPs were used)
    if (this.redis) {
      const keys = await this.redis.keys('lockout:ip:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      this.memoryStore.clear();
    }
    await this.usersRepository.update(userId, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
    });
  }
}
