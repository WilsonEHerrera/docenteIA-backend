import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, SubmissionStatus, SuggestionStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AiUnavailableError, AiRunner } from '../ai/ai-runner.service';
import { TextEvaluationPort } from '../ai/ports/text-evaluation.port';
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
import { parseGrade, weightedAverage } from '../domain/weighted-average';
import { JobQueue } from '../jobs/job-queue';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityAccessService } from './activity-access.service';
import {
  buildEvaluationSchema,
  RubricCriterionData,
  storedCriteria,
  storedLevels,
} from './evaluation';
import {
  AiSuggestionView,
  CreateSubmissionsDto,
  CreateSubmissionsResult,
  EditSuggestionDto,
  SubmissionDetailView,
  SubmissionView,
  SuggestionListItem,
  SuggestionsQueryDto,
} from './submissions.dto';

const EVALUATE_JOB = 'submission.evaluate';

interface EvaluateJob {
  submissionId: string;
  userId: string | null;
}

const money = (value: Prisma.Decimal | null): string | null =>
  value ? new Decimal(value.toString()).toFixed(2) : null;

const toSuggestionView = (suggestion: {
  id: string;
  status: SuggestionStatus;
  suggestedScore: Prisma.Decimal | null;
  finalScore: Prisma.Decimal | null;
  criteria: Prisma.JsonValue;
  feedback: string;
  provider: string;
  promptVersion: string;
  createdAt: Date;
}): AiSuggestionView => {
  const criteria = storedCriteria.safeParse(suggestion.criteria);
  return {
    id: suggestion.id,
    type: 'GRADE',
    status: suggestion.status,
    suggestedScore: money(suggestion.suggestedScore),
    finalScore: money(suggestion.finalScore),
    criteria: criteria.success ? criteria.data : [],
    feedback: suggestion.feedback,
    modelVersion: suggestion.provider,
    promptVersion: suggestion.promptVersion,
    createdAt: suggestion.createdAt.toISOString(),
  };
};

@Injectable()
export class SubmissionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ActivityAccessService,
    private readonly jobs: JobQueue,
    private readonly ai: AiRunner,
    private readonly textEvaluation: TextEvaluationPort,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.register<EvaluateJob>(EVALUATE_JOB, (job) => this.evaluate(job));
    void this.recoverInterrupted();
  }

  // --- Upload -------------------------------------------------------------

  /** Stores each text and queues its evaluation. Evaluating never blocks the request. */
  async create(
    actor: AuthUser,
    activityId: string,
    dto: CreateSubmissionsDto,
    ip?: string,
  ): Promise<CreateSubmissionsResult> {
    const activity = await this.access.findOwned(actor, activityId);

    const rubric = await this.prisma.rubric.findUnique({
      where: { activityId: activity.id },
      select: { id: true },
    });
    if (!rubric) {
      throw new AppError(
        409,
        'RUBRIC_REQUIRED',
        'Crea la rúbrica de la actividad antes de subir entregas.',
      );
    }

    const [enrollments, existing] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          courseId: activity.courseId,
          institutionId: actor.institutionId,
          deletedAt: null,
        },
        select: { studentId: true },
      }),
      this.prisma.submission.findMany({
        where: {
          activityId: activity.id,
          studentId: { in: dto.items.map((i) => i.studentId) },
        },
        include: { suggestions: { select: { status: true } } },
      }),
    ]);
    const enrolled = new Set(enrollments.map((e) => e.studentId));
    const previous = new Map(existing.map((s) => [s.studentId, s]));
    const seen = new Set<string>();

    const result: CreateSubmissionsResult = { accepted: 0, rejected: [] };
    const reject = (studentId: string, reason: string) =>
      result.rejected.push({ studentId, reason });

    for (const item of dto.items) {
      const text = item.text.trim();
      const before = previous.get(item.studentId);

      if (seen.has(item.studentId)) {
        reject(item.studentId, 'DUPLICATE');
      } else if (!enrolled.has(item.studentId)) {
        reject(item.studentId, 'STUDENT_NOT_ENROLLED');
      } else if (text === '') {
        reject(item.studentId, 'EMPTY_TEXT');
      } else if (before?.status === SubmissionStatus.PROCESSING) {
        reject(item.studentId, 'ALREADY_PROCESSING');
      } else if (
        before?.suggestions.some(
          (s) => s.status === 'APPROVED' || s.status === 'EDITED',
        )
      ) {
        reject(item.studentId, 'ALREADY_GRADED');
      } else {
        const submission = await this.prisma.$transaction(async (tx) => {
          const saved = await tx.submission.upsert({
            where: {
              activityId_studentId: {
                activityId: activity.id,
                studentId: item.studentId,
              },
            },
            update: { text, status: SubmissionStatus.PROCESSING },
            create: {
              institutionId: actor.institutionId,
              activityId: activity.id,
              studentId: item.studentId,
              text,
              status: SubmissionStatus.PROCESSING,
            },
          });
          // A new text supersedes any suggestion still waiting for approval.
          await tx.aiSuggestion.updateMany({
            where: { submissionId: saved.id, status: 'PENDING_APPROVAL' },
            data: { status: 'REJECTED', decidedAt: new Date() },
          });
          return saved;
        });
        await this.jobs.enqueue<EvaluateJob>(
          EVALUATE_JOB,
          { submissionId: submission.id, userId: actor.id },
          submission.id,
        );
        result.accepted += 1;
      }
      seen.add(item.studentId);
    }

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'SUBMISSIONS_CREATE',
      resource: 'activity',
      resourceId: activity.id,
      ip,
      diff: { accepted: result.accepted, rejected: result.rejected.length },
    });
    return result;
  }

  // --- Evaluation (background) -------------------------------------------

  /**
   * Runs inside the job queue. It must never throw: any failure leaves the
   * submission in MANUAL_REQUIRED so the teacher grades it by hand.
   */
  private async evaluate(job: EvaluateJob): Promise<void> {
    try {
      const submission = await this.prisma.submission.findUnique({
        where: { id: job.submissionId },
        include: {
          activity: {
            include: {
              rubric: {
                include: { criteria: { orderBy: { position: 'asc' } } },
              },
            },
          },
        },
      });
      if (!submission || submission.status !== SubmissionStatus.PROCESSING) {
        return;
      }
      const rubric = submission.activity.rubric;
      if (!rubric) {
        await this.markManual(submission.id);
        return;
      }

      const criteria: RubricCriterionData[] = rubric.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        weightPct: c.weightPct.toString(),
        levels: storedLevels.parse(c.levels),
      }));

      const output = await this.ai.run({
        kind: 'TEXT_EVALUATION',
        institutionId: submission.institutionId,
        userId: job.userId ?? undefined,
        provider: this.textEvaluation.provider,
        promptVersion: this.textEvaluation.promptVersion,
        schema: buildEvaluationSchema(criteria, submission.text),
        call: () =>
          this.textEvaluation.evaluate({
            text: submission.text,
            rubric: {
              criteria: criteria.map((c) => ({
                id: c.id,
                name: c.name,
                levels: c.levels.map((l) => ({
                  name: l.name,
                  score: Number(l.score),
                })),
              })),
            },
          }),
      });

      // The score comes from the rubric level, never from the model's number.
      const results = output.criteria.map((item) => {
        const criterion = criteria.find((c) => c.id === item.criterionId);
        const level = criterion?.levels.find((l) => l.name === item.level);
        if (!criterion || !level) {
          throw new Error('Validated output no longer matches the rubric');
        }
        return {
          criterionId: criterion.id,
          criterionName: criterion.name,
          weightPct: new Decimal(criterion.weightPct).toFixed(2),
          level: level.name,
          score: level.score,
          justification: item.justification,
          evidenceQuote: item.evidenceQuote,
        };
      });
      const suggestedScore = weightedAverage(
        results.map((r) => ({ value: r.score, weightPct: r.weightPct })),
      );

      await this.prisma.$transaction([
        this.prisma.aiSuggestion.create({
          data: {
            institutionId: submission.institutionId,
            submissionId: submission.id,
            status: 'PENDING_APPROVAL',
            suggestedScore: suggestedScore.toFixed(2),
            feedback: output.feedback,
            criteria: results,
            provider: this.textEvaluation.provider,
            promptVersion: this.textEvaluation.promptVersion,
          },
        }),
        this.prisma.submission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.SUGGESTED },
        }),
      ]);
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) {
        this.logger.error(
          `Evaluation of ${job.submissionId} failed`,
          error instanceof Error ? error.message : undefined,
        );
      }
      await this.markManual(job.submissionId);
    }
  }

  private async markManual(submissionId: string): Promise<void> {
    try {
      await this.prisma.submission.updateMany({
        where: { id: submissionId, status: SubmissionStatus.PROCESSING },
        data: { status: SubmissionStatus.MANUAL_REQUIRED },
      });
    } catch (error) {
      this.logger.error(
        `Could not mark ${submissionId} as MANUAL_REQUIRED`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  /** The queue is in memory: re-queue whatever a restart left in PROCESSING. */
  private async recoverInterrupted(): Promise<void> {
    try {
      const pending = await this.prisma.submission.findMany({
        where: { status: SubmissionStatus.PROCESSING },
        select: { id: true },
      });
      for (const { id } of pending) {
        await this.jobs.enqueue<EvaluateJob>(
          EVALUATE_JOB,
          { submissionId: id, userId: null },
          id,
        );
      }
      if (pending.length > 0) {
        this.logger.log(
          `Re-queued ${pending.length} interrupted evaluation(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Could not recover interrupted evaluations',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  // --- Reads --------------------------------------------------------------

  async listSubmissions(
    actor: AuthUser,
    activityId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SubmissionView>> {
    const activity = await this.access.findOwned(actor, activityId);
    const where: Prisma.SubmissionWhereInput = {
      activityId: activity.id,
      institutionId: actor.institutionId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        include: {
          student: true,
          suggestions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.submission.count({ where }),
    ]);
    return paginated(
      rows.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentCode: s.student.code,
        studentName: s.student.fullName,
        status: s.status,
        updatedAt: s.updatedAt.toISOString(),
        suggestionId: s.suggestions[0]?.id ?? null,
        suggestionStatus: s.suggestions[0]?.status ?? null,
      })),
      total,
      query,
    );
  }

  async listSuggestions(
    actor: AuthUser,
    activityId: string,
    query: SuggestionsQueryDto,
  ): Promise<Paginated<SuggestionListItem>> {
    const activity = await this.access.findOwned(actor, activityId);
    const where: Prisma.AiSuggestionWhereInput = {
      institutionId: actor.institutionId,
      submission: { activityId: activity.id },
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiSuggestion.findMany({
        where,
        include: { submission: { include: { student: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.aiSuggestion.count({ where }),
    ]);
    return paginated(
      rows.map((s) => ({
        ...toSuggestionView(s),
        submissionId: s.submissionId,
        studentId: s.submission.studentId,
        studentCode: s.submission.student.code,
        studentName: s.submission.student.fullName,
      })),
      total,
      query,
    );
  }

  async getSubmissionSuggestion(
    actor: AuthUser,
    submissionId: string,
  ): Promise<SubmissionDetailView> {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        institutionId: actor.institutionId,
        activity: {
          deletedAt: null,
          course: {
            institutionId: actor.institutionId,
            teacherId: actor.id,
            deletedAt: null,
          },
        },
      },
      include: {
        student: true,
        suggestions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!submission) {
      throw new AppError(404, 'NOT_FOUND', 'Entrega no encontrada.');
    }
    const latest = submission.suggestions[0];
    return {
      submission: {
        id: submission.id,
        studentId: submission.studentId,
        studentCode: submission.student.code,
        studentName: submission.student.fullName,
        status: submission.status,
        text: submission.text,
      },
      suggestion: latest ? toSuggestionView(latest) : null,
    };
  }

  // --- Teacher decision ---------------------------------------------------

  /** The only way an AI score becomes a grade: the teacher accepts it as is. */
  async approve(
    actor: AuthUser,
    suggestionId: string,
    ip?: string,
  ): Promise<AiSuggestionView> {
    const suggestion = await this.findOwnedSuggestion(actor, suggestionId);
    if (suggestion.suggestedScore === null) {
      throw new AppError(
        409,
        'NO_SUGGESTED_SCORE',
        'La sugerencia no tiene puntaje; califica manualmente.',
      );
    }
    return this.decide(
      actor,
      suggestion,
      'APPROVED',
      new Decimal(suggestion.suggestedScore.toString()),
      suggestion.feedback,
      ip,
    );
  }

  async edit(
    actor: AuthUser,
    suggestionId: string,
    dto: EditSuggestionDto,
    ip?: string,
  ): Promise<AiSuggestionView> {
    const finalScore = applyRule(() => parseGrade(dto.finalScore));
    const suggestion = await this.findOwnedSuggestion(actor, suggestionId);
    return this.decide(
      actor,
      suggestion,
      'EDITED',
      finalScore,
      dto.feedback.trim(),
      ip,
    );
  }

  /** Rejecting writes no grade: the teacher grades the work by hand. */
  async reject(
    actor: AuthUser,
    suggestionId: string,
    ip?: string,
  ): Promise<AiSuggestionView> {
    const suggestion = await this.findOwnedSuggestion(actor, suggestionId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.aiSuggestion.updateMany({
        where: { id: suggestion.id, status: 'PENDING_APPROVAL' },
        data: {
          status: 'REJECTED',
          decidedById: actor.id,
          decidedAt: new Date(),
        },
      });
      if (count === 0) this.throwAlreadyDecided();
      await tx.submission.update({
        where: { id: suggestion.submissionId },
        data: { status: SubmissionStatus.MANUAL_REQUIRED },
      });
      return tx.aiSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
      });
    });

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'SUGGESTION_REJECT',
      resource: 'ai_suggestion',
      resourceId: suggestion.id,
      ip,
      diff: { submissionId: suggestion.submissionId },
    });
    return toSuggestionView(updated);
  }

  private async decide(
    actor: AuthUser,
    suggestion: Awaited<ReturnType<SubmissionsService['findOwnedSuggestion']>>,
    status: 'APPROVED' | 'EDITED',
    finalScore: Decimal,
    feedback: string,
    ip?: string,
  ): Promise<AiSuggestionView> {
    const { activityId, studentId } = suggestion.submission;

    const { updated, before } = await this.prisma.$transaction(async (tx) => {
      // Guarded: two simultaneous decisions cannot both write a grade.
      const { count } = await tx.aiSuggestion.updateMany({
        where: { id: suggestion.id, status: 'PENDING_APPROVAL' },
        data: {
          status,
          finalScore: finalScore.toFixed(2),
          feedback,
          decidedById: actor.id,
          decidedAt: new Date(),
        },
      });
      if (count === 0) this.throwAlreadyDecided();

      const previous = await tx.grade.findUnique({
        where: { activityId_studentId: { activityId, studentId } },
        select: { value: true },
      });
      await tx.grade.upsert({
        where: { activityId_studentId: { activityId, studentId } },
        update: { value: finalScore.toFixed(2) },
        create: {
          institutionId: actor.institutionId,
          activityId,
          studentId,
          value: finalScore.toFixed(2),
        },
      });
      return {
        before: previous?.value ?? null,
        updated: await tx.aiSuggestion.findUniqueOrThrow({
          where: { id: suggestion.id },
        }),
      };
    });

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: status === 'APPROVED' ? 'SUGGESTION_APPROVE' : 'SUGGESTION_EDIT',
      resource: 'ai_suggestion',
      resourceId: suggestion.id,
      ip,
      diff: {
        submissionId: suggestion.submissionId,
        suggestedScore: money(suggestion.suggestedScore),
        finalScore: finalScore.toFixed(2),
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'GRADE_UPDATE',
      resource: 'grade',
      resourceId: null,
      ip,
      diff: {
        activityId,
        studentId,
        from: money(before),
        to: finalScore.toFixed(2),
        source: 'AI_SUGGESTION',
        suggestionId: suggestion.id,
      },
    });
    return toSuggestionView(updated);
  }

  private async findOwnedSuggestion(actor: AuthUser, suggestionId: string) {
    const suggestion = await this.prisma.aiSuggestion.findFirst({
      where: {
        id: suggestionId,
        institutionId: actor.institutionId,
        submission: {
          activity: {
            deletedAt: null,
            course: {
              institutionId: actor.institutionId,
              teacherId: actor.id,
              deletedAt: null,
            },
          },
        },
      },
      include: {
        submission: { select: { activityId: true, studentId: true } },
      },
    });
    if (!suggestion) {
      throw new AppError(404, 'NOT_FOUND', 'Sugerencia no encontrada.');
    }
    return suggestion;
  }

  private throwAlreadyDecided(): never {
    throw new AppError(
      409,
      'SUGGESTION_ALREADY_DECIDED',
      'Esta sugerencia ya fue resuelta.',
    );
  }
}
