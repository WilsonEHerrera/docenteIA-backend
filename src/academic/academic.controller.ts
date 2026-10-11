import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { Audit, CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { AcademicService } from './academic.service';
import {
  CourseDetailView,
  CourseView,
  CreateCourseDto,
  CreateScheduleDto,
  CreateStudentDto,
  CreateSubjectDto,
  EnrollStudentDto,
  ImportReport,
} from './academic.dto';
import { CourseOwnershipGuard } from './course-ownership.guard';

const READERS = [Role.TEACHER, Role.COORDINATOR, Role.ADMIN];

@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get('subjects')
  @Roles(...READERS)
  listSubjects(@CurrentUser() actor: AuthUser) {
    return this.academic.listSubjects(actor);
  }

  @Post('subjects')
  @Roles(Role.ADMIN)
  @Audit({ action: 'SUBJECT_CREATE', resource: 'subject' })
  createSubject(@CurrentUser() actor: AuthUser, @Body() dto: CreateSubjectDto) {
    return this.academic.createSubject(actor, dto);
  }

  @Get('courses')
  @Roles(...READERS)
  listCourses(
    @CurrentUser() actor: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CourseView>> {
    return this.academic.listCourses(actor, query);
  }

  @Post('courses')
  @Roles(Role.ADMIN)
  @Audit({ action: 'COURSE_CREATE', resource: 'course' })
  createCourse(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateCourseDto,
  ): Promise<CourseView> {
    return this.academic.createCourse(actor, dto);
  }

  /** Body is raw `text/csv` (see app.setup). */
  @Post('courses/import')
  @Roles(Role.ADMIN)
  importCourses(
    @CurrentUser() actor: AuthUser,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ImportReport> {
    if (typeof body !== 'string' || body.trim() === '') {
      throw new AppError(
        400,
        'CSV_REQUIRED',
        'Envía el archivo CSV como cuerpo con Content-Type: text/csv.',
      );
    }
    return this.academic.importEnrollments(actor, body, req.ip);
  }

  @Get('courses/:id')
  @Roles(...READERS)
  @UseGuards(CourseOwnershipGuard)
  getCourse(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CourseDetailView> {
    return this.academic.getCourse(actor, id);
  }

  @Post('courses/:id/schedules')
  @Roles(Role.ADMIN)
  @Audit({ action: 'SCHEDULE_CREATE', resource: 'schedule' })
  createSchedule(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.academic.createSchedule(actor, id, dto);
  }

  @Post('courses/:id/enrollments')
  @Roles(Role.ADMIN)
  @Audit({ action: 'ENROLLMENT_CREATE', resource: 'enrollment' })
  enroll(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollStudentDto,
  ) {
    return this.academic.enroll(actor, id, dto.studentCode);
  }

  @Post('students')
  @Roles(Role.ADMIN)
  @Audit({ action: 'STUDENT_CREATE', resource: 'student' })
  createStudent(@CurrentUser() actor: AuthUser, @Body() dto: CreateStudentDto) {
    return this.academic.createStudent(actor, dto);
  }
}
