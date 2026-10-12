import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AppError } from '../common/app-error';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  ConsentView,
  CourseConsentRow,
  FaceReferenceView,
  GrantConsentDto,
  GuardianStudentView,
  GuardianView,
  LinkGuardianDto,
  RevokeConsentQueryDto,
  StudentConsentStatus,
} from './consent.dto';
import { ConsentService } from './consent.service';
import { FaceReferenceService } from './face-reference.service';

/** Consent is granted by a linked GUARDIAN or by an ADMIN on their behalf. */
const CONSENT_MANAGERS = [Role.ADMIN, Role.GUARDIAN];

@Controller()
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly faceReference: FaceReferenceService,
  ) {}

  // --- Consent ------------------------------------------------------------

  @Post('students/:id/consents')
  @Roles(...CONSENT_MANAGERS)
  grant(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantConsentDto,
    @Req() req: Request,
  ): Promise<ConsentView> {
    return this.consent.grant(actor, id, dto, req.ip);
  }

  @Get('students/:id/consents')
  @Roles(...CONSENT_MANAGERS)
  status(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StudentConsentStatus> {
    return this.consent.status(actor, id);
  }

  /** Revoking also deletes the student's facial reference. */
  @Delete('students/:id/consents')
  @Roles(...CONSENT_MANAGERS)
  @HttpCode(204)
  async revoke(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RevokeConsentQueryDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.consent.revoke(actor, id, query.purpose, req.ip);
  }

  @Get('courses/:id/consents')
  @Roles(Role.TEACHER, Role.COORDINATOR, Role.ADMIN)
  @UseGuards(CourseOwnershipGuard)
  courseOverview(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CourseConsentRow[]> {
    return this.consent.courseOverview(actor, id);
  }

  // --- Facial reference ---------------------------------------------------

  /** Body is the raw photo (`image/jpeg` or `image/png`, see app.setup). */
  @Put('students/:id/face-reference')
  @Roles(...CONSENT_MANAGERS)
  registerReference(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<FaceReferenceView> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(
        400,
        'IMAGE_REQUIRED',
        'Envía la foto como cuerpo con Content-Type image/jpeg o image/png.',
      );
    }
    return this.faceReference.register(actor, id, body, req.ip);
  }

  @Delete('students/:id/face-reference')
  @Roles(...CONSENT_MANAGERS)
  @HttpCode(204)
  async removeReference(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.faceReference.remove(actor, id, req.ip);
  }

  // --- Guardians ----------------------------------------------------------

  @Get('students/:id/guardians')
  @Roles(Role.ADMIN)
  listGuardians(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GuardianView[]> {
    return this.consent.listGuardians(actor, id);
  }

  @Post('students/:id/guardians')
  @Roles(Role.ADMIN)
  linkGuardian(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
    @Req() req: Request,
  ): Promise<GuardianView> {
    return this.consent.linkGuardian(actor, id, dto.userId, req.ip);
  }

  @Delete('students/:id/guardians/:userId')
  @Roles(Role.ADMIN)
  @HttpCode(204)
  async unlinkGuardian(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.consent.unlinkGuardian(actor, id, userId, req.ip);
  }

  @Get('guardians/me/students')
  @Roles(Role.GUARDIAN)
  myStudents(@CurrentUser() actor: AuthUser): Promise<GuardianStudentView[]> {
    return this.consent.myStudents(actor);
  }
}
