import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators';
import { paginated, PaginationQueryDto, skipTake } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

interface AuditLogView {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ip: string | null;
  diff: unknown;
  at: Date;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(Role.ADMIN)
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: AuditQueryDto,
  ): Promise<Paginated<AuditLogView>> {
    const where = {
      institutionId: user.institutionId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? { at: { gte: query.from, lte: query.to } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      ip: row.ip,
      diff: row.diff,
      at: row.at,
    }));
    return paginated(data, total, query);
  }
}
