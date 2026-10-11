import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthedRequest, AuthUser } from './types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const THROTTLE_KEY = 'throttle';
export const AUDIT_KEY = 'audit';

/** Opt out of JWT. Everything without this decorator is private. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict an endpoint to the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Apply the per-IP/route rate limit (AUTH_RATE_LIMIT_PER_MIN). */
export const Throttle = () => SetMetadata(THROTTLE_KEY, true);

export interface AuditMeta {
  action: string;
  resource: string;
}

/** Record an AuditLog entry when the handler succeeds. */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without authentication');
    }
    return req.user;
  },
);
