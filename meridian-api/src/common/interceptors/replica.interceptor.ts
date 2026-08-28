import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to force a query to use the replica (read-only)
 * Can be applied to controller methods that should always read from replica
 */
export const UseReplica = () => SetMetadata('USE_REPLICA', true);

/**
 * Decorator to force a query to use the master (primary)
 * Can be applied to controller methods that need consistent reads
 */
export const UseMaster = () => SetMetadata('USE_MASTER', true);

/**
 * Interceptor that routes read operations to the replica data source
 * when TypeORM replication is configured.
 *
 * Routing logic:
 * - If DATABASE_REPLICA_URL is configured, TypeORM has replication enabled
 * - By default, SELECT queries go to replica, INSERT/UPDATE/DELETE go to master
 * - @UseReplica() decorator forces replica usage
 * - @UseMaster() decorator forces master usage
 * - If no replica is configured, all queries go to master
 */
@Injectable()
export class ReplicaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ReplicaInterceptor.name);
  private hasReplica: boolean;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    // Check if replication is configured
    this.hasReplica = this.isReplicationConfigured();
    if (this.hasReplica) {
      this.logger.log('Read-replica routing enabled');
    } else {
      this.logger.log('No replica configured - all queries will use master');
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();

    // Check for explicit routing decorators
    const forceReplica = Reflect.getMetadata('USE_REPLICA', handler);
    const forceMaster = Reflect.getMetadata('USE_MASTER', handler);

    // Store routing decision in request for downstream use. Decorator
    // metadata is undefined when unset; normalise to explicit booleans so
    // consumers can rely on the shape (issue #665 baseline repair).
    request.replicaRouting = {
      useReplica: Boolean(this.hasReplica && (forceReplica || !forceMaster)),
      forceReplica: forceReplica === true,
      forceMaster: forceMaster === true,
    };

    if (this.hasReplica) {
      if (forceReplica) {
        this.logger.debug(
          `Forcing replica usage for ${request.method} ${request.url}`,
        );
      } else if (forceMaster) {
        this.logger.debug(
          `Forcing master usage for ${request.method} ${request.url}`,
        );
      } else {
        this.logger.debug(
          `Using default routing for ${request.method} ${request.url}`,
        );
      }
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Log successful query routing
          if (this.hasReplica && request.replicaRouting) {
            const routing = request.replicaRouting;
            this.logger.debug(
              `Query completed - Replica: ${routing.useReplica}, Force: ${routing.forceReplica || routing.forceMaster}`,
            );
          }
        },
        error: (error) => {
          this.logger.error(
            `Query failed for ${request.method} ${request.url}: ${error.message}`,
          );
        },
      }),
    );
  }

  /**
   * Check if TypeORM replication is configured
   */
  private isReplicationConfigured(): boolean {
    try {
      const driver = this.dataSource.driver;
      // TypeORM stores replication config in the driver
      const replication = (driver as any).replication;
      return (
        !!replication && replication.slaves && replication.slaves.length > 0
      );
    } catch (error) {
      this.logger.warn(`Failed to check replication config: ${error}`);
      return false;
    }
  }

  /**
   * Get the current replica routing status
   * Can be used by services to check if they should use replica
   */
  static getReplicaRouting(context: ExecutionContext): {
    useReplica: boolean;
    forceReplica: boolean;
    forceMaster: boolean;
  } | null {
    const request = context.switchToHttp().getRequest();
    return request.replicaRouting || null;
  }
}
