import {
  ForbiddenException,
  Injectable,
  Logger,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignInDto } from '../dto/sign-in.dto';
import { UserAuthFacade } from 'src/users/providers/user-auth.facade';
import { HashingProvider } from './hashing';
import { JwtService } from '@nestjs/jwt';
import jwtConfig from '../config/jwt.config';
import { ConfigType } from '@nestjs/config';
import { GenerateTokenProvider } from './token.provider';
import { LockoutService } from './lockout.service';
import { AccountLockedException } from '../exceptions/account-locked.exception';

@Injectable()
export class SignInProviders {
  private readonly logger = new Logger(SignInProviders.name);

  constructor(
    private readonly userAuthFacade: UserAuthFacade,

    //intra dependcy injection of hash provider
    private readonly hashingProvider: HashingProvider,

    // injecting generatetokenprovider
    private readonly generateTokenProvider: GenerateTokenProvider,

    // Account lockout (issue #650)
    private readonly lockoutService: LockoutService,
  ) {}

  public async SignIn(signInDto: SignInDto, ip?: string) {
    // find user by email
    const user = await this.userAuthFacade.findUserByEmail(signInDto.email);

    // Account lockout gate (issue #650): reject before hashing if locked.
    // Uses a *generic* message identical to wrong-password so enumerators
    // cannot distinguish locked vs. non-existent accounts.
    const isLocked = await this.lockoutService.isAccountLocked(user.id);
    if (isLocked) {
      this.logger.warn(
        `Sign-in rejected: account ${user.id} is locked`,
      );
      throw new AccountLockedException();
    }

    //compare the password to the hashed password
    let isEqual: boolean = false;
    try {
      isEqual = await this.hashingProvider.comparePassword(
        signInDto.password,
        user.password,
      );
    } catch (error) {
      throw new RequestTimeoutException(error, {
        description: 'error connecting to database',
      });
    }

    //send a confirmation
    if (!isEqual) {
      // Track the failure in Redis / DB
      const result = await this.lockoutService.recordFailedAttempt(
        user.id,
        ip ?? 'unknown',
      );

      if (result.accountLocked) {
        this.logger.warn(
          `Account ${user.id} locked after consecutive failures (lockedUntil: ${result.lockedUntil})`,
        );
        // EventService webhook + email notification are triggered by
        // AuthService after catching this exception — see auth.service.ts.
      }

      // Always return a generic message so the caller cannot determine
      // whether the email exists, the password was wrong, or the account
      // is locked.
      throw new UnauthorizedException('Invalid credentials');
    }

    // Email-verification gate (issue #435): we deliberately reject AFTER the
    // password match so a successful sign-in only happens for verified users.
    // The 403 wording is intentionally generic so the response cannot be
    // used to enumerate which emails have been registered.
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Please verify your email before signing in.',
      );
    }

    // Successful sign-in — reset failure counters
    await this.lockoutService.clearOnSuccess(user.id, ip ?? 'unknown');

    const token = await this.generateTokenProvider.generateTokens(user);
    return [token, user];
  }
}
