import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { DataSource } from 'typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './config/env.validation';
import { join } from 'path';

import { CryptoModule } from './crypto/crypto.module';

import { UsersModule } from './users/users.module';
import { PostModule } from './post/post.module';
import { TagModule } from './tag/tag.module';
import { MetaoptionModule } from './metaoption/metaoption.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { PaginationModule } from './common/pagination/pagination.module';

import jwtConfig from './auth/config/jwt.config';
import { DataResponseInterceptor } from './common/interceptors/data-response.interceptor';
import { AccessTokenGuard } from './auth/guard/access-token/access-token.guard';
import { RbacGuard } from './auth/guard/rbac/rbac.guard';
import { MailProvider } from './mail/providers/mail.provider';
import { TweetModule } from './tweets/tweet.module';
import { UploadModule } from './upload/upload.module';
import { HealthModule } from './health/health.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { AuditModule } from './audit/audit.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    /**
     * GLOBAL ENV CONFIG
     * Local → .env
     * Railway → Railway variables
     */
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    /**
     * RATE LIMITING CONFIG
     */
    ThrottlerModule.forRoot([
      {
        name: 'read',
        ttl: 60000,
        limit: 100, // 100 requests per minute for GET
      },
      {
        name: 'write',
        ttl: 60000,
        limit: 20, // 20 requests per minute for POST/PUT/PATCH/DELETE
      },
    ]),

    /**
     * DATABASE CONFIG (Railway + Local Compatible)
     */
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');

        // ✅ If Railway provides DATABASE_URL → use it
        if (databaseUrl) {
          return {
            type: 'postgres',
            url: databaseUrl,
            autoLoadEntities: true,
            synchronize: false,
            migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
            migrationsRun: true,
            ssl: {
              rejectUnauthorized: false,
            },
            retryAttempts: process.env.NODE_ENV === 'test' ? 1 : 10,
            retryDelay: process.env.NODE_ENV === 'test' ? 100 : 3000,
          };
        }

        // ✅ Local development fallback
        return {
          type: 'postgres',
          host: config.get<string>('POSTGRES_HOST'),
          port: Number(config.get('POSTGRES_PORT')),
          username: config.get<string>('POSTGRES_USER'),
          password: config.get<string>('POSTGRES_PASSWORD'),
          database: config.get<string>('POSTGRES_DB'),
          synchronize: config.get<string>('POSTGRES_SYNC') === 'true',
          // Run migrations instead of synchronize when sync is off (prod-like).
          migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
          migrationsRun: config.get<string>('POSTGRES_SYNC') !== 'true',
          autoLoadEntities: config.get<string>('POSTGRES_LOAD') === 'true',
          retryAttempts: process.env.NODE_ENV === 'test' ? 1 : 10,
          retryDelay: process.env.NODE_ENV === 'test' ? 100 : 3000,
        };
      },
    }),

    ConfigModule.forFeature(jwtConfig),
    JwtModule.registerAsync(jwtConfig.asProvider()),

    CryptoModule,
    UsersModule,
    PostModule,
    TagModule,
    MetaoptionModule,
    AuthModule,
    MailModule,
    PaginationModule,
    TweetModule,
    UploadModule,
    HealthModule,
    PrometheusModule.register(),
    AuditModule,
    EventsModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DataResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // RBAC (issue #632): global guard that authenticates every request unless
    // marked @Public() and enforces @RequireRoles / @RequirePermissions
    // metadata against the role/permission claims embedded in the JWT.
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    AccessTokenGuard,
    RbacGuard,
    MailProvider,
  ],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
}
