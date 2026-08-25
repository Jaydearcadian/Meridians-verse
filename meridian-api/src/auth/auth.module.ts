import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './providers/auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from 'src/users/users.module';
import { HashingProvider } from 'src/auth/providers/hashing';
import { BcryptProvider } from './providers/bcrypt';
import { SignInProviders } from './providers/sign-in.providers';
import { LockoutService } from './providers/lockout.service';
import { ConfigModule } from '@nestjs/config';
import jwtConfig from './config/jwt.config';
import { JwtModule } from '@nestjs/jwt';
import { GenerateTokenProvider } from './providers/token.provider';
import { RefreshTokenProvider } from './providers/refreshToken.provider';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerifyEmailProvider } from './providers/verify-email.provider';
import {
  BcryptVerificationTokenProvider,
  VerificationTokenProvider,
} from './providers/verification-token.provider';
import { User } from 'src/users/user.entity';
import { CryptoModule } from 'src/crypto/crypto.module';
import { AuditModule } from 'src/audit/audit.module';
import { EventsModule } from 'src/events/events.module';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    ConfigModule.forFeature(jwtConfig),
    JwtModule.registerAsync(jwtConfig.asProvider()),
    TypeOrmModule.forFeature([RefreshToken, User]),
    CryptoModule,
    AuditModule,
    EventsModule,
    MailModule,
  ],
  providers: [
    AuthService,
    GenerateTokenProvider,
    RefreshTokenProvider,
    { provide: HashingProvider, useClass: BcryptProvider },
    SignInProviders,
    LockoutService,
    VerifyEmailProvider,
    {
      provide: VerificationTokenProvider,
      useClass: BcryptVerificationTokenProvider,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, HashingProvider, LockoutService],
})
export class AuthModule {}
