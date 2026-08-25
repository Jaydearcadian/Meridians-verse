jest.mock(
  'src/users/providers/user-auth.facade',
  () => ({ UserAuthFacade: class UserAuthFacade {} }),
  { virtual: true },
);
jest.mock(
  'src/users/providers/user.services',
  () => ({ UserService: class UserService {} }),
  { virtual: true },
);
jest.mock('src/DTO/signin-dto', () => ({}), { virtual: true });
jest.mock('./hashing', () => ({ HashingProvider: class HashingProvider {} }));
jest.mock('./token.provider', () => ({
  GenerateTokenProvider: class GenerateTokenProvider {},
}));
jest.mock('../config/jwt.config', () => ({ default: { KEY: 'jwt' } }), {
  virtual: true,
});
jest.mock('./lockout.service', () => ({
  LockoutService: class LockoutService {},
}));
jest.mock('../exceptions/account-locked.exception', () => ({
  AccountLockedException: class AccountLockedException extends Error {
    constructor(message?: string) {
      super(message ?? 'Invalid credentials');
    }
  },
}));

import {
  ForbiddenException,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignInProviders } from './sign-in.providers';
import { AccountLockedException } from '../exceptions/account-locked.exception';

describe('SignInProviders', () => {
  let provider: SignInProviders;
  let userAuthFacade: { findUserByEmail: jest.Mock };
  let hashingProvider: { comparePassword: jest.Mock };
  let generateTokenProvider: { generateTokens: jest.Mock };
  let lockoutService: {
    isAccountLocked: jest.Mock;
    recordFailedAttempt: jest.Mock;
    clearOnSuccess: jest.Mock;
  };

  // Default mock user is verified so the pre-existing password-paths below
  // continue to pass after the 403 verification gate was added
  // (issue #435).
  const user = {
    id: 1,
    email: 'a@b.com',
    password: 'hashed',
    emailVerified: true,
  };

  beforeEach(() => {
    userAuthFacade = {
      findUserByEmail: jest.fn(async () => user),
    };
    hashingProvider = {
      comparePassword: jest.fn(async () => true),
    };
    generateTokenProvider = {
      generateTokens: jest.fn(async () => ({
        access_token: 'a',
        refresh_token: 'r',
        jti: 'j',
      })),
    };
    lockoutService = {
      isAccountLocked: jest.fn(async () => false),
      recordFailedAttempt: jest.fn(async () => ({
        accountLocked: false,
        ipLocked: false,
        lockedUntil: null,
      })),
      clearOnSuccess: jest.fn(async () => undefined),
    };

    provider = new SignInProviders(
      userAuthFacade as any,
      hashingProvider as any,
      generateTokenProvider as any,
      lockoutService as any,
    );
  });

  it('returns the tokens and user on successful sign-in', async () => {
    const tokens = await provider.SignIn({
      email: 'a@b.com',
      password: 'plain',
    } as any);

    expect(userAuthFacade.findUserByEmail).toHaveBeenCalledWith('a@b.com');
    expect(hashingProvider.comparePassword).toHaveBeenCalledWith(
      'plain',
      user.password,
    );
    expect(generateTokenProvider.generateTokens).toHaveBeenCalledWith(user);
    expect(tokens).toEqual([
      { access_token: 'a', refresh_token: 'r', jti: 'j' },
      user,
    ]);
  });

  it('throws UnauthorizedException when the password does not match', async () => {
    hashingProvider.comparePassword.mockResolvedValueOnce(false);

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'wrong' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(generateTokenProvider.generateTokens).not.toHaveBeenCalled();
  });

  it('wraps hashing errors in a RequestTimeoutException', async () => {
    hashingProvider.comparePassword.mockRejectedValueOnce(new Error('boom'));

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'plain' } as any),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  // --- Account lockout (issue #650) ---

  it('throws AccountLockedException when the account is locked', async () => {
    lockoutService.isAccountLocked.mockResolvedValueOnce(true);

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'plain' } as any),
    ).rejects.toBeInstanceOf(AccountLockedException);
    expect(hashingProvider.comparePassword).not.toHaveBeenCalled();
  });

  it('records a failed attempt when the password is wrong', async () => {
    hashingProvider.comparePassword.mockResolvedValueOnce(false);

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'wrong' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(lockoutService.recordFailedAttempt).toHaveBeenCalledWith(
      1,
      'unknown',
    );
  });

  it('clears counters on successful sign-in', async () => {
    await provider.SignIn({ email: 'a@b.com', password: 'plain' } as any);
    expect(lockoutService.clearOnSuccess).toHaveBeenCalledWith(1, 'unknown');
  });

  it('passes the IP address to recordFailedAttempt', async () => {
    hashingProvider.comparePassword.mockResolvedValueOnce(false);

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'wrong' } as any, '192.168.1.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(lockoutService.recordFailedAttempt).toHaveBeenCalledWith(
      1,
      '192.168.1.1',
    );
  });

  /**
   * Email verification gate (issue #435): the 403 path lets clients render
   * a "please verify first" message without leaking account-existence to
   * anyone who guessed a real password.
   */
  it('throws ForbiddenException (HTTP 403) when the email is not verified', async () => {
    userAuthFacade.findUserByEmail.mockResolvedValueOnce({
      ...user,
      emailVerified: false,
    });

    await expect(
      provider.SignIn({ email: 'a@b.com', password: 'plain' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(generateTokenProvider.generateTokens).not.toHaveBeenCalled();
  });
});
