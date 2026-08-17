import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: any): Promise<boolean> {
    const { context, throttler } = requestProps;

    const req = context.switchToHttp().getRequest();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const throttlerName = throttler.name || 'default';

    // If it's a read request, ignore the "write" throttler
    if (!isWrite && throttlerName === 'write') {
      return true;
    }

    // If it's a write request, ignore the "read" throttler
    if (isWrite && throttlerName === 'read') {
      return true;
    }

    return super.handleRequest(requestProps);
  }
}
