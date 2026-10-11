import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from '../security/crypto';
import { passwordPolicyViolation } from '../security/password-policy';
import { PasswordService } from '../security/password.service';
import { TokenService } from '../security/token.service';
import { PasswordResetNotifier } from './password-reset-notifier';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  institutionId: string;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  /** Raw refresh token: goes to the httpOnly cookie, never into the body. */
  refreshToken: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
const invalidRefresh = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'La sesión ya no es válida.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly notifier: PasswordResetNotifier,
  ) {}

  async login(email: string, password: string, ip?: string): Promise<Session> {
    const { LOGIN_MAX_ATTEMPTS, LOCKOUT_MINUTES } = this.config.values;
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });

    if (!user || !user.isActive || !user.passwordHash) {
      await this.passwords.verifyDummy(password);
      if (user)
        await this.logAuth('LOGIN_FAILED', user, ip, {
          reason: 'inactive_or_no_password',
        });
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.logAuth('LOGIN_BLOCKED', user, ip);
      throw new AppError(
        423,
        'ACCOUNT_LOCKED',
        'La cuenta está bloqueada temporalmente por intentos fallidos. Intenta más tarde.',
      );
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= LOGIN_MAX_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * MINUTE_MS),
          },
        });
        await this.logAuth('ACCOUNT_LOCKED', user, ip);
      }
      await this.logAuth('LOGIN_FAILED', user, ip, { reason: 'bad_password' });
      throw invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await this.logAuth('LOGIN_SUCCESS', user, ip);
    return this.issueSession(user, randomUUID());
  }

  /** Rotates the refresh token. Presenting an already-rotated token kills the whole family. */
  async refresh(rawToken: string | undefined, ip?: string): Promise<Session> {
    if (!rawToken) throw invalidRefresh();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!stored) throw invalidRefresh();

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.logAuth('REFRESH_REUSE_DETECTED', stored.user, ip);
      throw invalidRefresh();
    }

    const { user } = stored;
    if (stored.expiresAt <= new Date() || !user.isActive || user.deletedAt) {
      throw invalidRefresh();
    }

    // Conditional update: only one concurrent request can rotate this token.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) throw invalidRefresh();

    return this.issueSession(user, stored.familyId);
  }

  async logout(rawToken: string | undefined, ip?: string): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.logAuth('LOGOUT', stored.user, ip);
  }

  /** Same observable behavior whether or not the email exists. */
  async forgotPassword(email: string, ip?: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: normalized, deletedAt: null, isActive: true },
    });
    if (!user) return;

    const token = randomToken();
    const ttl = this.config.values.RESET_TOKEN_TTL_MINUTES * MINUTE_MS;
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttl),
        },
      }),
    ]);
    await this.logAuth('PASSWORD_RESET_REQUESTED', user, ip);
    await this.notifier.send({ userId: user.id, email: user.email, token });
  }

  async resetPassword(
    token: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const invalid = new AppError(
      400,
      'INVALID_RESET_TOKEN',
      'El enlace de recuperación no es válido o ya expiró.',
    );
    if (!stored || stored.usedAt || stored.expiresAt <= new Date())
      throw invalid;
    if (!stored.user.isActive || stored.user.deletedAt) throw invalid;

    const violation = passwordPolicyViolation(newPassword, stored.user.email);
    if (violation) throw new AppError(400, 'WEAK_PASSWORD', violation);

    const passwordHash = await this.passwords.hash(newPassword);
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.logAuth('PASSWORD_RESET', stored.user, ip);
  }

  private async issueSession(user: User, familyId: string): Promise<Session> {
    const refreshToken = randomToken();
    const ttl = this.config.values.REFRESH_TTL_DAYS * DAY_MS;
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    const { token, expiresIn } = this.tokens.signAccess({
      id: user.id,
      institutionId: user.institutionId,
      role: user.role,
    });
    return {
      accessToken: token,
      expiresIn,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        institutionId: user.institutionId,
      },
    };
  }

  private logAuth(
    action: string,
    user: Pick<User, 'id' | 'institutionId'>,
    ip?: string,
    diff?: Record<string, string>,
  ): Promise<void> {
    return this.audit.record({
      institutionId: user.institutionId,
      userId: user.id,
      action,
      resource: 'auth',
      resourceId: user.id,
      ip,
      diff,
    });
  }
}
