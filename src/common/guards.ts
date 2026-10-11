import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AppConfig } from '../config/app-config';
import { TokenService } from '../security/token.service';
import { AppError } from './app-error';
import { IS_PUBLIC_KEY, ROLES_KEY, THROTTLE_KEY } from './decorators';
import { AuthedRequest } from './types';

/** Authenticates every route unless it is marked @Public. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    const user = this.tokens.verifyAccess(token);
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

/** Role check (first authorization level). Ownership is checked per resource. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** In-memory fixed-window limiter per IP + route. Per-instance; move to Redis when scaling out. */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.reflector.getAllAndOverride<boolean | undefined>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!enabled) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const limit = this.config.values.AUTH_RATE_LIMIT_PER_MIN;
    const now = Date.now();
    const key = `${req.ip ?? 'unknown'}:${req.method}:${req.path}`;

    if (this.buckets.size > 10_000) this.evictExpired(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > limit) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((bucket.resetAt - now) / 1000)),
      );
      throw new AppError(
        429,
        'TOO_MANY_REQUESTS',
        'Demasiados intentos. Intenta de nuevo en un minuto.',
      );
    }
    return true;
  }

  private evictExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
