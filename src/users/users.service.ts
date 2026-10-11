import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import {
  Paginated,
  paginated,
  PaginationQueryDto,
  skipTake,
} from '../common/pagination';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { passwordPolicyViolation } from '../security/password-policy';
import { PasswordService } from '../security/password.service';
import { CreateUserDto, UpdateUserDto, UserView } from './users.dto';

const toView = (user: User): UserView => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  isActive: user.isActive,
  lockedUntil: user.lockedUntil,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<UserView>> {
    const where: Prisma.UserWhereInput = {
      institutionId: actor.institutionId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(toView), total, query);
  }

  async create(
    actor: AuthUser,
    dto: CreateUserDto,
    ip?: string,
  ): Promise<UserView> {
    const email = dto.email.trim().toLowerCase();
    this.assertStrong(dto.password, email);

    const user = await this.prisma.user.create({
      data: {
        institutionId: actor.institutionId,
        email,
        fullName: dto.fullName.trim(),
        role: dto.role,
        passwordHash: await this.passwords.hash(dto.password),
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'USER_CREATE',
      resource: 'user',
      resourceId: user.id,
      ip,
      diff: { role: user.role },
    });
    return toView(user);
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateUserDto,
    ip?: string,
  ): Promise<UserView> {
    const current = await this.prisma.user.findFirst({
      where: { id, institutionId: actor.institutionId, deletedAt: null },
    });
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado.');
    }
    if (
      id === actor.id &&
      (dto.isActive === false || (dto.role && dto.role !== current.role))
    ) {
      throw new AppError(
        400,
        'SELF_CHANGE_FORBIDDEN',
        'No puedes desactivarte ni cambiar tu propio rol.',
      );
    }

    const data: Prisma.UserUpdateInput = {};
    const diff: Record<
      string,
      { from: string | boolean; to: string | boolean }
    > = {};
    if (dto.fullName !== undefined && dto.fullName !== current.fullName) {
      data.fullName = dto.fullName.trim();
      diff.fullName = { from: current.fullName, to: data.fullName };
    }
    if (dto.role !== undefined && dto.role !== current.role) {
      data.role = dto.role;
      diff.role = { from: current.role, to: dto.role };
    }
    if (dto.isActive !== undefined && dto.isActive !== current.isActive) {
      data.isActive = dto.isActive;
      diff.isActive = { from: current.isActive, to: dto.isActive };
    }
    if (dto.unlock) {
      data.failedLoginAttempts = 0;
      data.lockedUntil = null;
      diff.unlock = { from: false, to: true };
    }
    if (dto.password !== undefined) {
      this.assertStrong(dto.password, current.email);
      data.passwordHash = await this.passwords.hash(dto.password);
      diff.password = { from: 'redacted', to: 'changed' };
    }

    const revokeSessions =
      dto.isActive === false || dto.password !== undefined || diff.role;
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data }),
      ...(revokeSessions
        ? [
            this.prisma.refreshToken.updateMany({
              where: { userId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);

    if (Object.keys(diff).length > 0) {
      await this.audit.record({
        institutionId: actor.institutionId,
        userId: actor.id,
        action: diff.role ? 'USER_ROLE_CHANGE' : 'USER_UPDATE',
        resource: 'user',
        resourceId: id,
        ip,
        diff,
      });
    }
    return toView(updated);
  }

  async revokeSessions(
    actor: AuthUser,
    id: string,
    ip?: string,
  ): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id, institutionId: actor.institutionId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado.');
    }
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'USER_SESSIONS_REVOKED',
      resource: 'user',
      resourceId: id,
      ip,
    });
  }

  private assertStrong(password: string, email: string): void {
    const violation = passwordPolicyViolation(password, email);
    if (violation) throw new AppError(400, 'WEAK_PASSWORD', violation);
  }
}
