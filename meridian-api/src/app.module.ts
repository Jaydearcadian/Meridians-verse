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
import { CorrelationModule } from './common/correlation/correlation.module';
import { CorrelationIdInterceptor } from './common/correlation/correlation-id.interceptor';
import { RateLimitModule } from './rate-limit/rate-limit.module';

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
     * RATE LIMITING CONFIG (issue #647)
     * Named read/write throttlers feed default quotas; CustomThrottlerGuard
     * enforces them via Redis sliding windows instead of in-memory storage.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'read',
          ttl: Number(config.get('RATE_LIMIT_WINDOW_MS') ?? 60_000),
          limit: Number(config.get('RATE_LIMIT_READ_LIMIT') ?? 100),
        },
        {
          name: 'write',
          ttl: Number(config.get('RATE_LIMIT_WINDOW_MS') ?? 60_000),
          limit: Number(config.get('RATE_LIMIT_WRITE_LIMIT') ?? 20),
        },
      ],
    }),
    RateLimitModule,

    /**
     * DATABASE CONFIG (Railway + Local Compatible)
     * Added connection pool configuration and read-replica support
     */
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        const replicaUrl = config.get<string>('DATABASE_REPLICA_URL');

        // Connection pool configuration
        const poolMin = config.get<number>('DB_POOL_MIN', 2);
        const poolMax = config.get<number>('DB_POOL_MAX', 10);
        const poolIdleTimeout = config.get<number>('DB_POOL_IDLE_TIMEOUT_MS', 30000);

        const baseConfig = {
          type: 'postgres' as const,
          autoLoadEntities: true,
          synchronize: false,
          migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
          migrationsRun: true,
          ssl: {
            rejectUnauthorized: false,
          },
          retryAttempts: process.env.NODE_ENV === 'test' ? 1 : 10,
          retryDelay: process.env.NODE_ENV === 'test' ? 100 : 3000,
          // Connection pool settings
          extra: {
            max: poolMax,
            min: poolMin,
            idleTimeoutMillis: poolIdleTimeout,
          },
        };

        // ✅ If Railway provides DATABASE_URL → use it
        if (databaseUrl) {
          return {
            ...baseConfig,
            url: databaseUrl,
            // Read-replica configuration (if replica URL is provided)
            replication: replicaUrl
              ? {
                  master: {
                    url: databaseUrl,
                  },
                  slaves: [
                    {
                      url: replicaUrl,
                    },
                  ],
                }
              : undefined,
          };
        }

        // ✅ Local development fallback
        return {
          ...baseConfig,
          host: config.get<string>('POSTGRES_HOST'),
          port: Number(config.get('POSTGRES_PORT')),
          username: config.get<string>('POSTGRES_USER'),
          password: config.get<string>('POSTGRES_PASSWORD'),
          database: config.get<string>('POSTGRES_DB'),
          synchronize: config.get<string>('POSTGRES_SYNC') === 'true',
          migrationsRun: config.get<string>('POSTGRES_SYNC') !== 'true',
          autoLoadEntities: config.get<string>('POSTGRES_LOAD') === 'true',
          // Read-replica configuration for local development (if replica vars are set)
          replication: replicaUrl
            ? {
                master: {
                  host: config.get<string>('POSTGRES_HOST'),
                  port: Number(config.get('POSTGRES_PORT')),
                  username: config.get<string>('POSTGRES_USER'),
                  password: config.get<string>('POSTGRES_PASSWORD'),
                  database: config.get<string>('POSTGRES_DB'),
                },
                slaves: [
                  {
                    url: replicaUrl,
                  },
                ],
              }
            : undefined,
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
    CorrelationModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DataResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // RBAC (issue #632): global guard that authenticates every request unless
    // marked @Public() and enforces @RequireRoles / @RequirePermissions
    // metadata against the role/permission claims embedded in the JWT.
    // APP_GUARD instantiates RbacGuard itself (no separate provider needed).
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    AccessTokenGuard,
    MailProvider,
  ],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
}
