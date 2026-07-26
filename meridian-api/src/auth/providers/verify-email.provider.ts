import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { User } from 'src/users/user.entity';
import { VerificationTokenProvider } from './verification-token.provider';
import { MailProvider } from 'src/mail/providers/mail.provider';
import { VERIFICATION_TTL_MS } from './verification-token.constants';

/**
 * Email-verification flows (issue #435).
 *
 *  - `issueVerificationToken`: hash a fresh raw token and persist it on the
 *    user row with an expiry; dispatch the templated mail containing the
 *    raw token. Mail send failures are logged but never re-thrown so an
 *    unreachable SMTP server cannot block account creation.
 *  - `verifyEmail`: locate the matching user via the bcrypt hash, clear
 *    the token columns, and flip `emailVerified` true. Throws
 *    UnauthorizedException for *any* invalid / expired / consumed token so
 *    callers cannot distinguish the failure mode.
 */
@Injectable()
export class VerifyEmailProvider {
  private readonly logger = new Logger(VerifyEmailProvider.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly tokenProvider: VerificationTokenProvider,

    private readonly mailService: MailProvider,
  ) {}

  /**
   * Generate a verification token for a freshly-created (or unverified)
   * user, persist its hash, and email the raw token.
   */
  public async issueVerificationToken(user: User): Promise<void> {
    const raw = this.tokenProvider.generate();
    const hashed = await this.tokenProvider.hash(raw);

    const expires = new Date(Date.now() + VERIFICATION_TTL_MS);

    await this.usersRepository.update(user.id, {
      emailVerificationToken: hashed,
      emailVerificationExpires: expires,
      emailVerified: false,
    });

    try {
      await this.mailService.VerificationEmail(user, raw, expires);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email for user ${user.id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Resolve a raw verification token to its user. Marks the user as
   * verified and clears the token columns on success.
   */
  public async verifyEmail(rawToken: string): Promise<User> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    const now = new Date();
    const candidates = await this.usersRepository.find({
      where: {
        emailVerificationToken: Not(IsNull()),
        emailVerificationExpires: MoreThan(now),
      },
    });

    for (const user of candidates) {
      const matches = await this.tokenProvider.compare(
        rawToken,
        // Property is non-null because of the Not(IsNull()) filter above;
        // narrow for TypeScript.
        user.emailVerificationToken as string,
      );
      if (!matches) {
        continue;
      }

      await this.usersRepository.update(user.id, {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });

      return { ...user, emailVerified: true };
    }

    throw new UnauthorizedException('Invalid or expired verification token');
  }
}
