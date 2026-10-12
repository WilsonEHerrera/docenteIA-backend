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
import { Audit, CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import {
  CreateQuestionDto,
  GenerateQuizDto,
  QuestionView,
  QuizSummaryView,
  QuizView,
  UpdateQuestionDto,
  UpdateQuizDto,
} from './quizzes.dto';
import { QuizzesService } from './quizzes.service';

@Controller()
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  /** 202: questions are generated in the background; poll `GET /quizzes/:id`. */
  @Post('quizzes/generate')
  @Roles(Role.TEACHER)
  @HttpCode(202)
  @Audit({ action: 'QUIZ_GENERATE', resource: 'quiz' })
  generate(
    @CurrentUser() actor: AuthUser,
    @Body() dto: GenerateQuizDto,
  ): Promise<QuizView> {
    return this.quizzes.generate(actor, dto);
  }

  @Get('courses/:id/quizzes')
  @Roles(Role.TEACHER, Role.COORDINATOR)
  @UseGuards(CourseOwnershipGuard)
  listByCourse(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<QuizSummaryView>> {
    return this.quizzes.listByCourse(actor, id, query);
  }

  @Get('quizzes/:id')
  @Roles(Role.TEACHER)
  get(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuizView> {
    return this.quizzes.get(actor, id);
  }

  @Patch('quizzes/:id')
  @Roles(Role.TEACHER)
  rename(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuizDto,
  ): Promise<QuizView> {
    return this.quizzes.rename(actor, id, dto.title);
  }

  @Post('quizzes/:id/questions')
  @Roles(Role.TEACHER)
  addQuestion(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuestionDto,
    @Req() req: Request,
  ): Promise<QuestionView> {
    return this.quizzes.addQuestion(actor, id, dto, req.ip);
  }

  /** Approve every question still `PENDING_APPROVAL` (explicit teacher action). */
  @Post('quizzes/:id/questions/approve')
  @Roles(Role.TEACHER)
  @HttpCode(200)
  approvePending(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<QuizView> {
    return this.quizzes.approvePending(actor, id, req.ip);
  }

  @Patch('quizzes/:id/questions/:qid')
  @Roles(Role.TEACHER)
  updateQuestion(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('qid', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
    @Req() req: Request,
  ): Promise<QuestionView> {
    return this.quizzes.updateQuestion(actor, id, questionId, dto, req.ip);
  }

  @Post('quizzes/:id/publish')
  @Roles(Role.TEACHER)
  @HttpCode(200)
  @Audit({ action: 'QUIZ_PUBLISH', resource: 'quiz' })
  publish(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuizView> {
    return this.quizzes.publish(actor, id);
  }
}
