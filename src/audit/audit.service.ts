import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  institutionId?: string | null;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  diff?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit failure must not break the user's request, but it is logged. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          institutionId: entry.institutionId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          ip: entry.ip ?? null,
          diff: entry.diff,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not write audit log ${entry.action}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}
