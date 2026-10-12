import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { Audit, CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { RubricsService } from './rubrics.service';
import {
  AiSuggestionView,
  CreateSubmissionsDto,
  CreateSubmissionsResult,
  EditSuggestionDto,
  RubricView,
  SubmissionDetailView,
  SubmissionView,
  SuggestionListItem,
  SuggestionsQueryDto,
  UpsertRubricDto,
} from './submissions.dto';
import { SubmissionsService } from './submissions.service';

/**
 * Teacher-only. Every handler is scoped to the teacher's own courses; the
 * service answers 404 for anything else.
 */
@Controller()
@Roles(Role.TEACHER)
export class SubmissionsController {
  constructor(
    private readonly rubrics: RubricsService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Get('activities/:id/rubric')
  getRubric(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RubricView> {
    return this.rubrics.get(actor, id);
  }

  @Post('activities/:id/rubric')
  @Audit({ action: 'RUBRIC_UPSERT', resource: 'rubric' })
  upsertRubric(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRubricDto,
  ): Promise<RubricView> {
    return this.rubrics.upsert(actor, id, dto);
  }

  /** 202: texts are stored and evaluated in the background (poll the list). */
  @Post('activities/:id/submissions')
  @HttpCode(202)
  createSubmissions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubmissionsDto,
    @Req() req: Request,
  ): Promise<CreateSubmissionsResult> {
    return this.submissions.create(actor, id, dto, req.ip);
  }

  @Get('activities/:id/submissions')
  listSubmissions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SubmissionView>> {
    return this.submissions.listSubmissions(actor, id, query);
  }

  @Get('activities/:id/suggestions')
  listSuggestions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SuggestionsQueryDto,
  ): Promise<Paginated<SuggestionListItem>> {
    return this.submissions.listSuggestions(actor, id, query);
  }

  @Get('submissions/:id/suggestion')
  getSuggestion(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubmissionDetailView> {
    return this.submissions.getSubmissionSuggestion(actor, id);
  }

  @Post('suggestions/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AiSuggestionView> {
    return this.submissions.approve(actor, id, req.ip);
  }

  @Post('suggestions/:id/edit')
  @HttpCode(200)
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditSuggestionDto,
    @Req() req: Request,
  ): Promise<AiSuggestionView> {
    return this.submissions.edit(actor, id, dto, req.ip);
  }

  @Post('suggestions/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AiSuggestionView> {
    return this.submissions.reject(actor, id, req.ip);
  }
}
