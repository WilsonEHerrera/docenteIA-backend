import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { Audit, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  ActivityView,
  CreateActivityDto,
  GradeView,
  GradebookQueryDto,
  GradebookView,
  UpdateActivityDto,
  UpdateGradeDto,
} from './grades.dto';
import { GradesService } from './grades.service';

@Controller()
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get('courses/:id/gradebook')
  @Roles(Role.TEACHER, Role.COORDINATOR)
  @UseGuards(CourseOwnershipGuard)
  gradebook(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GradebookQueryDto,
  ): Promise<GradebookView> {
    return this.grades.gradebook(actor, id, query.period);
  }

  @Post('courses/:id/activities')
  @Roles(Role.TEACHER)
  @UseGuards(CourseOwnershipGuard)
  @Audit({ action: 'ACTIVITY_CREATE', resource: 'activity' })
  createActivity(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ActivityView> {
    return this.grades.createActivity(actor, id, dto);
  }

  @Patch('activities/:id')
  @Roles(Role.TEACHER)
  @Audit({ action: 'ACTIVITY_UPDATE', resource: 'activity' })
  updateActivity(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityView> {
    return this.grades.updateActivity(actor, id, dto);
  }

  /** Writes its own AuditLog (with the before/after diff), so no @Audit here. */
  @Put('grades/:id')
  @Roles(Role.TEACHER)
  setGrade(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeDto,
    @Req() req: Request,
  ): Promise<GradeView> {
    return this.grades.setGrade(actor, id, dto.value, req.ip);
  }
}
