import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, QuizStatus, SuggestionStatus } from '@prisma/client';
import { z } from 'zod';
import { AiRunner } from '../ai/ai-runner.service';
import { QuizGenerationPort } from '../ai/ports/quiz-generation.port';
import { quizOutput } from '../ai/schemas/ai-output.schemas';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { applyRule } from '../common/apply-rule';
import {
  Paginated,
  paginated,
  PaginationQueryDto,
  skipTake,
} from '../common/pagination';
import { AuthUser } from '../common/types';
import {
  assertValidQuestion,
  publishBlocker,
  TRUE_FALSE_OPTIONS,
} from '../domain/quiz-rules';
import { DomainRuleError } from '../domain/weighted-average';
import { JobQueue } from '../jobs/job-queue';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateQuestionDto,
  GenerateQuizDto,
  QuestionView,
  QuizSummaryView,
  QuizView,
  UpdateQuestionDto,
} from './quizzes.dto';

const GENERATE_JOB = 'quiz.generate';
const DEFAULT_COUNT = 5;

interface GenerateJob {
  quizId: string;
  userId: string | null;
}

const quizInclude = {
  questions: { orderBy: { position: 'asc' } },
} satisfies Prisma.QuizInclude;

type QuizWithQuestions = Prisma.QuizGetPayload<{
  include: typeof quizInclude;
}>;
type QuestionRow = QuizWithQuestions['questions'][number];

const optionsOf = (json: Prisma.JsonValue): string[] => {
  const parsed = z.array(z.string()).safeParse(json);
  return parsed.success ? parsed.data : [];
};

const toQuestionView = (question: QuestionRow): QuestionView => ({
  id: question.id,
  position: question.position,
  type: question.type,
  prompt: question.prompt,
  options: optionsOf(question.options),
  correctIndex: question.correctIndex,
  explanation: question.explanation,
  status: question.status,
});

const toQuizView = (quiz: QuizWithQuestions): QuizView => ({
  id: quiz.id,
  courseId: quiz.courseId,
  title: quiz.title,
  topic: quiz.topic,
  status: quiz.status,
  provider: quiz.provider,
  promptVersion: quiz.promptVersion,
  createdAt: quiz.createdAt.toISOString(),
  publishedAt: quiz.publishedAt?.toISOString() ?? null,
  questions: quiz.questions.map(toQuestionView),
});

/** Provider output + the same well-formedness rules the teacher's edits must meet. */
const generationSchema = (maxQuestions: number) =>
  quizOutput.superRefine((questions, ctx) => {
    if (questions.length > maxQuestions) {
      ctx.addIssue({ code: 'custom', message: 'Demasiadas preguntas' });
    }
    for (const question of questions) {
      try {
        assertValidQuestion(question);
      } catch (error) {
        if (!(error instanceof DomainRuleError)) throw error;
        ctx.addIssue({ code: 'custom', message: error.message });
      }
    }
  });

@Injectable()
export class QuizzesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
    private readonly ai: AiRunner,
    private readonly generator: QuizGenerationPort,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.register<GenerateJob>(GENERATE_JOB, (job) =>
      this.runGeneration(job),
    );
    void this.recoverInterrupted();
  }

  // --- Generation ---------------------------------------------------------

  /** 202-style: the quiz is created GENERATING and filled in the background. */
  async generate(actor: AuthUser, dto: GenerateQuizDto): Promise<QuizView> {
    const topic = dto.topic?.trim() || null;
    const sourceText = dto.sourceText?.trim() || null;
    if (!topic && !sourceText) {
      throw new AppError(
        400,
        'SOURCE_REQUIRED',
        'Indica un tema o un texto base para generar el cuestionario.',
      );
    }
    const course = await this.prisma.course.findFirst({
      where: {
        id: dto.courseId,
        institutionId: actor.institutionId,
        teacherId: actor.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');

    const quiz = await this.prisma.quiz.create({
      data: {
        institutionId: actor.institutionId,
        courseId: course.id,
        createdById: actor.id,
        title: (
          dto.title?.trim() || `Cuestionario: ${topic ?? 'texto base'}`
        ).slice(0, 120),
        topic,
        sourceText,
        requestedCount: dto.count ?? DEFAULT_COUNT,
        status: QuizStatus.GENERATING,
      },
      include: quizInclude,
    });
    await this.jobs.enqueue<GenerateJob>(
      GENERATE_JOB,
      { quizId: quiz.id, userId: actor.id },
      quiz.id,
    );
    return toQuizView(quiz);
  }

  /** Runs in the job queue and never throws: failure leaves the quiz for manual authoring. */
  private async runGeneration(job: GenerateJob): Promise<void> {
    try {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id: job.quizId },
      });
      if (!quiz || quiz.status !== QuizStatus.GENERATING) return;

      const questions = await this.ai.run({
        kind: 'QUIZ_GENERATION',
        institutionId: quiz.institutionId,
        userId: job.userId ?? undefined,
        provider: this.generator.provider,
        promptVersion: this.generator.promptVersion,
        schema: generationSchema(quiz.requestedCount),
        call: () =>
          this.generator.generate({
            topic: quiz.topic ?? undefined,
            sourceText: quiz.sourceText ?? undefined,
            count: quiz.requestedCount,
          }),
      });

      await this.prisma.$transaction([
        this.prisma.quizQuestion.createMany({
          data: questions.map((q, position) => ({
            quizId: quiz.id,
            position,
            type: q.type,
            prompt: q.prompt,
            options: q.type === 'OPEN' ? [] : q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            // The AI never approves: every question waits for the teacher.
            status: SuggestionStatus.PENDING_APPROVAL,
          })),
        }),
        this.prisma.quiz.updateMany({
          where: { id: quiz.id, status: QuizStatus.GENERATING },
          data: {
            status: QuizStatus.DRAFT,
            provider: this.generator.provider,
            promptVersion: this.generator.promptVersion,
          },
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Quiz generation ${job.quizId} fell back to manual (${
          error instanceof Error ? error.name : 'unknown error'
        })`,
      );
      await this.markManual(job.quizId);
    }
  }

  private async markManual(quizId: string): Promise<void> {
    try {
      await this.prisma.quiz.updateMany({
        where: { id: quizId, status: QuizStatus.GENERATING },
        data: { status: QuizStatus.MANUAL_REQUIRED },
      });
    } catch (error) {
      this.logger.error(
        `Could not mark quiz ${quizId} as MANUAL_REQUIRED`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  /** The source text is stored, so interrupted generations are simply re-queued. */
  private async recoverInterrupted(): Promise<void> {
    try {
      const pending = await this.prisma.quiz.findMany({
        where: { status: QuizStatus.GENERATING },
        select: { id: true },
      });
      for (const { id } of pending) {
        await this.jobs.enqueue<GenerateJob>(
          GENERATE_JOB,
          { quizId: id, userId: null },
          id,
        );
      }
    } catch (error) {
      this.logger.error(
        'Could not recover interrupted quiz generations',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  // --- Reads --------------------------------------------------------------

  async get(actor: AuthUser, quizId: string): Promise<QuizView> {
    return toQuizView(await this.findOwned(actor, quizId));
  }

  /** Ownership of the course is enforced by CourseOwnershipGuard. */
  async listByCourse(
    actor: AuthUser,
    courseId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<QuizSummaryView>> {
    const where: Prisma.QuizWhereInput = {
      courseId,
      institutionId: actor.institutionId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.quiz.findMany({
        where,
        include: { questions: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.quiz.count({ where }),
    ]);
    return paginated(
      rows.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        status: quiz.status,
        questionCount: quiz.questions.length,
        approvedCount: quiz.questions.filter(
          (q) => q.status === 'APPROVED' || q.status === 'EDITED',
        ).length,
        pendingCount: quiz.questions.filter(
          (q) => q.status === 'PENDING_APPROVAL',
        ).length,
        createdAt: quiz.createdAt.toISOString(),
        publishedAt: quiz.publishedAt?.toISOString() ?? null,
      })),
      total,
      query,
    );
  }

  // --- Teacher edits ------------------------------------------------------

  async rename(
    actor: AuthUser,
    quizId: string,
    title: string,
  ): Promise<QuizView> {
    const quiz = await this.findOwned(actor, quizId);
    this.assertEditable(quiz.status);
    const updated = await this.prisma.quiz.update({
      where: { id: quiz.id },
      data: { title: title.trim() },
      include: quizInclude,
    });
    return toQuizView(updated);
  }

  /** A question the teacher writes is already decided: it is APPROVED. */
  async addQuestion(
    actor: AuthUser,
    quizId: string,
    dto: CreateQuestionDto,
    ip?: string,
  ): Promise<QuestionView> {
    const quiz = await this.findOwned(actor, quizId);
    this.assertEditable(quiz.status);

    // Nothing is dropped silently: what the teacher sent is what gets validated.
    // Only TRUE_FALSE has default options, since they are fixed.
    const options =
      dto.options ?? (dto.type === 'TRUE_FALSE' ? [...TRUE_FALSE_OPTIONS] : []);
    const correctIndex = dto.correctIndex ?? null;
    applyRule(() =>
      assertValidQuestion({ type: dto.type, options, correctIndex }),
    );

    const position =
      quiz.questions.reduce((max, q) => Math.max(max, q.position), -1) + 1;
    const created = await this.prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        position,
        type: dto.type,
        prompt: dto.prompt.trim(),
        options,
        correctIndex,
        explanation: dto.explanation?.trim() ?? '',
        origin: 'TEACHER',
        status: SuggestionStatus.APPROVED,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'QUESTION_CREATE',
      resource: 'quiz_question',
      resourceId: created.id,
      ip,
      diff: { quizId: quiz.id, type: dto.type },
    });
    return toQuestionView(created);
  }

  /** Editing the content counts as the teacher's decision (EDITED); `status` approves or rejects. */
  async updateQuestion(
    actor: AuthUser,
    quizId: string,
    questionId: string,
    dto: UpdateQuestionDto,
    ip?: string,
  ): Promise<QuestionView> {
    const quiz = await this.findOwned(actor, quizId);
    this.assertEditable(quiz.status);
    const question = quiz.questions.find((q) => q.id === questionId);
    if (!question) {
      throw new AppError(404, 'NOT_FOUND', 'Pregunta no encontrada.');
    }

    const contentChanged =
      dto.prompt !== undefined ||
      dto.options !== undefined ||
      dto.correctIndex !== undefined ||
      dto.explanation !== undefined;
    if (!contentChanged && dto.status === undefined)
      return toQuestionView(question);

    const options = dto.options ?? optionsOf(question.options);
    const correctIndex =
      dto.correctIndex !== undefined ? dto.correctIndex : question.correctIndex;
    if (contentChanged) {
      applyRule(() =>
        assertValidQuestion({ type: question.type, options, correctIndex }),
      );
    }

    const nextStatus: SuggestionStatus =
      dto.status === 'REJECTED'
        ? 'REJECTED'
        : contentChanged
          ? 'EDITED'
          : (dto.status ?? question.status);

    const updated = await this.prisma.quizQuestion.update({
      where: { id: question.id },
      data: {
        ...(dto.prompt !== undefined ? { prompt: dto.prompt.trim() } : {}),
        ...(dto.explanation !== undefined
          ? { explanation: dto.explanation.trim() }
          : {}),
        ...(contentChanged ? { options, correctIndex } : {}),
        status: nextStatus,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'QUESTION_UPDATE',
      resource: 'quiz_question',
      resourceId: question.id,
      ip,
      diff: {
        quizId: quiz.id,
        from: question.status,
        to: nextStatus,
        contentChanged,
      },
    });
    return toQuestionView(updated);
  }

  /** Explicit, bulk teacher decision: approves every question still waiting. */
  async approvePending(
    actor: AuthUser,
    quizId: string,
    ip?: string,
  ): Promise<QuizView> {
    const quiz = await this.findOwned(actor, quizId);
    this.assertEditable(quiz.status);

    const { count } = await this.prisma.quizQuestion.updateMany({
      where: { quizId: quiz.id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'APPROVED',
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'QUESTIONS_APPROVE_ALL',
      resource: 'quiz',
      resourceId: quiz.id,
      ip,
      diff: { approved: count },
    });
    return toQuizView(await this.findOwned(actor, quizId));
  }

  /** Publishing freezes the quiz. Every question must have been decided by the teacher. */
  async publish(actor: AuthUser, quizId: string): Promise<QuizView> {
    const quiz = await this.findOwned(actor, quizId);
    this.assertEditable(quiz.status);

    const blocker = publishBlocker(quiz.questions.map((q) => q.status));
    if (blocker === 'PENDING_QUESTIONS') {
      throw new AppError(
        409,
        'PENDING_QUESTIONS',
        'Aprueba, edita o rechaza todas las preguntas antes de publicar.',
      );
    }
    if (blocker === 'NO_APPROVED_QUESTIONS') {
      throw new AppError(
        409,
        'NO_APPROVED_QUESTIONS',
        'El cuestionario necesita al menos una pregunta aprobada.',
      );
    }
    for (const question of quiz.questions) {
      if (question.status === 'APPROVED' || question.status === 'EDITED') {
        applyRule(() =>
          assertValidQuestion({
            type: question.type,
            options: optionsOf(question.options),
            correctIndex: question.correctIndex,
          }),
        );
      }
    }

    const { count } = await this.prisma.quiz.updateMany({
      where: {
        id: quiz.id,
        status: { in: [QuizStatus.DRAFT, QuizStatus.MANUAL_REQUIRED] },
      },
      data: { status: QuizStatus.PUBLISHED, publishedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(
        409,
        'QUIZ_PUBLISHED',
        'El cuestionario ya fue publicado.',
      );
    }
    return toQuizView(await this.findOwned(actor, quizId));
  }

  // --- Helpers ------------------------------------------------------------

  private assertEditable(status: QuizStatus): void {
    if (status === QuizStatus.PUBLISHED) {
      throw new AppError(
        409,
        'QUIZ_PUBLISHED',
        'El cuestionario ya fue publicado y no se puede modificar.',
      );
    }
    if (status === QuizStatus.GENERATING) {
      throw new AppError(
        409,
        'QUIZ_GENERATING',
        'El cuestionario aún se está generando.',
      );
    }
  }

  private async findOwned(
    actor: AuthUser,
    quizId: string,
  ): Promise<QuizWithQuestions> {
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        id: quizId,
        institutionId: actor.institutionId,
        course: {
          institutionId: actor.institutionId,
          teacherId: actor.id,
          deletedAt: null,
        },
      },
      include: quizInclude,
    });
    if (!quiz) {
      throw new AppError(404, 'NOT_FOUND', 'Cuestionario no encontrado.');
    }
    return quiz;
  }
}
