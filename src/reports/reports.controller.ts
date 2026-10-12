import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  AttendanceReport,
  AttendanceReportQueryDto,
  ExportQueryDto,
  PerformanceQueryDto,
  PerformanceReport,
} from './reports.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(Role.TEACHER, Role.COORDINATOR)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('performance')
  performance(
    @CurrentUser() actor: AuthUser,
    @Query() query: PerformanceQueryDto,
  ): Promise<PerformanceReport> {
    return this.reports.performance(actor, query.courseId, query.period);
  }

  @Get('attendance')
  attendance(
    @CurrentUser() actor: AuthUser,
    @Query() query: AttendanceReportQueryDto,
  ): Promise<AttendanceReport> {
    return this.reports.attendance(actor, query.courseId, query.from, query.to);
  }

  /** CSV download. Writes its own AuditLog (REPORT_EXPORT). */
  @Get('export')
  async export(
    @CurrentUser() actor: AuthUser,
    @Query() query: ExportQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.reports.export(actor, query, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return file.content;
  }
}
