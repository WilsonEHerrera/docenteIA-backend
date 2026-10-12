import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AppError } from '../common/app-error';
import { Audit, CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import {
  AttendanceRecordView,
  AttendanceSessionSummaryView,
  AttendanceSessionView,
  AttendanceSummaryView,
  CreateManualSessionDto,
  PhotoSessionQueryDto,
  UpdateRecordDto,
} from './attendance.dto';
import { AttendanceService } from './attendance.service';
import { FacialAttendanceService } from './facial-attendance.service';

@Controller()
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly facial: FacialAttendanceService,
  ) {}

  @Post('attendance/sessions/manual')
  @Roles(Role.TEACHER)
  @Audit({
    action: 'ATTENDANCE_SESSION_CREATE',
    resource: 'attendance_session',
  })
  createManual(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateManualSessionDto,
  ): Promise<AttendanceSessionView> {
    return this.attendance.createManual(actor, dto);
  }

  /**
   * Facial attendance. Body is the raw group photo (`image/jpeg` or
   * `image/png`, see app.setup). Answers 202 with a PROCESSING session: poll
   * `GET /attendance/sessions/:id` until READY or MANUAL_REQUIRED.
   */
  @Post('attendance/sessions')
  @Roles(Role.TEACHER)
  @HttpCode(202)
  @Audit({
    action: 'ATTENDANCE_SESSION_CREATE',
    resource: 'attendance_session',
  })
  createFromPhoto(
    @CurrentUser() actor: AuthUser,
    @Query() query: PhotoSessionQueryDto,
    @Body() body: unknown,
  ): Promise<AttendanceSessionView> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(
        400,
        'IMAGE_REQUIRED',
        'Envía la foto como cuerpo con Content-Type image/jpeg o image/png.',
      );
    }
    return this.facial.start(actor, query, body);
  }

  @Get('attendance/sessions/:id')
  @Roles(Role.TEACHER)
  getSession(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceSessionView> {
    return this.attendance.getSession(actor, id);
  }

  /** Writes its own AuditLog (with the before/after diff), so no @Audit here. */
  @Patch('attendance/sessions/:id/records/:rid')
  @Roles(Role.TEACHER)
  updateRecord(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rid', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdateRecordDto,
    @Req() req: Request,
  ): Promise<AttendanceRecordView> {
    return this.attendance.updateRecord(
      actor,
      id,
      recordId,
      dto.status,
      req.ip,
    );
  }

  @Post('attendance/sessions/:id/confirm')
  @Roles(Role.TEACHER)
  @Audit({ action: 'ATTENDANCE_CONFIRM', resource: 'attendance_session' })
  confirm(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceSessionView> {
    return this.attendance.confirm(actor, id);
  }

  @Get('courses/:id/attendance/sessions')
  @Roles(Role.TEACHER, Role.COORDINATOR)
  @UseGuards(CourseOwnershipGuard)
  listSessions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AttendanceSessionSummaryView>> {
    return this.attendance.listSessions(actor, id, query);
  }

  @Get('courses/:id/attendance/summary')
  @Roles(Role.TEACHER, Role.COORDINATOR)
  @UseGuards(CourseOwnershipGuard)
  summary(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceSummaryView> {
    return this.attendance.summary(actor, id);
  }
}
