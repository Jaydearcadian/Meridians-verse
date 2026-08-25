import { UnauthorizedException } from '@nestjs/common';

/**
 * Account lockout (issue #650): thrown when an account has exceeded the
 * configured number of consecutive failed login attempts.
 *
 * The HTTP response is deliberately identical to a normal "invalid credentials"
 * 401 so the response cannot be used to determine whether the account exists,
 * whether the password was correct, or whether the account is locked.
 */
export class AccountLockedException extends UnauthorizedException {
  constructor(message = 'Invalid credentials') {
    super(message);
  }
}
