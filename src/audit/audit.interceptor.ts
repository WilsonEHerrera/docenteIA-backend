import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMeta } from '../common/decorators';
import { AuthedRequest } from '../common/types';
import { AuditService } from './audit.service';

/** Records an AuditLog row for handlers decorated with @Audit(...) once they succeed. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return next.handle().pipe(
      tap((result: unknown) => {
        const body = (result ?? {}) as { id?: unknown };
        const params = req.params as Record<string, string | undefined>;
        const resourceId =
          typeof body.id === 'string' ? body.id : (params.id ?? null);
        void this.audit.record({
          institutionId: req.user?.institutionId,
          userId: req.user?.id,
          action: meta.action,
          resource: meta.resource,
          resourceId,
          ip: req.ip,
        });
      }),
    );
  }
}
