import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { AuthUser } from '../common/types';

interface AccessPayload {
  sub: string;
  inst: string;
  role: Role;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(
  JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
).toString('base64url');

const ROLES = new Set<string>(Object.values(Role));

/** Minimal HS256 JWT for short-lived access tokens (algorithm is fixed, never read from the token). */
@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  signAccess(
    user: AuthUser,
    now: Date = new Date(),
  ): { token: string; expiresIn: number } {
    const { ACCESS_TTL_SECONDS } = this.config.values;
    const iat = Math.floor(now.getTime() / 1000);
    const payload: AccessPayload = {
      sub: user.id,
      inst: user.institutionId,
      role: user.role,
      iat,
      exp: iat + ACCESS_TTL_SECONDS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(`${HEADER}.${body}`);
    return {
      token: `${HEADER}.${body}.${signature}`,
      expiresIn: ACCESS_TTL_SECONDS,
    };
  }

  verifyAccess(token: string, now: Date = new Date()): AuthUser | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    if (header !== HEADER) return null;

    const expected = Buffer.from(this.sign(`${header}.${body}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }

    let payload: Partial<AccessPayload>;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Partial<AccessPayload>;
    } catch {
      return null;
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.inst !== 'string' ||
      typeof payload.role !== 'string' ||
      !ROLES.has(payload.role) ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(now.getTime() / 1000)
    ) {
      return null;
    }
    return { id: payload.sub, institutionId: payload.inst, role: payload.role };
  }

  private sign(data: string): string {
    return createHmac('sha256', this.config.values.JWT_ACCESS_SECRET)
      .update(data)
      .digest('base64url');
  }
}
