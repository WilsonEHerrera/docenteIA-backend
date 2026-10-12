import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { AppConfig } from '../config/app-config';
import { shouldAlert } from '../domain/absence-alert';
import { isGradeAtRisk } from '../domain/grade-risk';
import {
  DomainRuleError,
  parseGrade,
  parseWeight,
  partialWeightedAverage,
  sumWeights,
  WEIGHT_TOTAL,
  weightedAverage,
  WeightedItem,
} from '../domain/weighted-average';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActivityView,
  CreateActivityDto,
  GradeView,
  GradebookRow,
  GradebookView,
  UpdateActivityDto,
} from './grades.dto';

const toActivityView = (activity: {
  id: string;
  courseId: string;
  name: string;
  weightPct: Prisma.Decimal;
  period: string;
}): ActivityView => ({
  id: activity.id,
  courseId: activity.courseId,
  name: activity.name,
  weightPct: new Decimal(activity.weightPct.toString()).toFixed(2),
  period: activity.period,
});

const toGradeView = (grade: {
  id: string;
  activityId: string;
  studentId: string;
  value: Prisma.Decimal | null;
}): GradeView => ({
  id: grade.id,
  activityId: grade.activityId,
  studentId: grade.studentId,
  value: grade.value ? new Decimal(grade.value.toString()).toFixed(2) : null,
});

/** Maps a domain rule violation to a 400 with its stable code. */
function applyRule<T>(rule: () => T): T {
  try {
    return rule();
  } catch (error) {
    if (error instanceof DomainRuleError) {
      throw new AppError(400, error.code, error.message);
    }
    throw error;
  }
}

@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly config: AppConfig,
  ) {}

  // --- Activities ---------------------------------------------------------

  /** Ownership is enforced by CourseOwnershipGuard; the institution filter is defense in depth. */
  async createActivity(
    actor: AuthUser,
    courseId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityView> {
    const weight = applyRule(() => parseWeight(dto.weightPct));
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
      },
      select: { id: true, period: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');
    const period = dto.period?.trim() || course.period;

    const activity = await this.serializable(async (tx) => {
      await this.assertWeightsFit(tx, courseId, period, weight, null);
      const created = await tx.activity.create({
        data: {
          institutionId: actor.institutionId,
          courseId,
          name: dto.name.trim(),
          weightPct: weight.toFixed(2),
          period,
        },
      });

      // One empty grade per enrolled student so every cell has an id to PUT to.
      const enrolled = await tx.enrollment.findMany({
        where: {
          courseId,
          institutionId: actor.institutionId,
          deletedAt: null,
        },
        select: { studentId: true },
      });
      await tx.grade.createMany({
        data: enrolled.map((e) => ({
          institutionId: actor.institutionId,
          activityId: created.id,
          studentId: e.studentId,
        })),
        skipDuplicates: true,
      });
      return created;
    });
    return toActivityView(activity);
  }

  async updateActivity(
    actor: AuthUser,
    activityId: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityView> {
    const existing = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        institutionId: actor.institutionId,
        deletedAt: null,
        course: {
          institutionId: actor.institutionId,
          teacherId: actor.id,
          deletedAt: null,
        },
      },
    });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Actividad no encontrada.');
    }
    const newWeight =
      dto.weightPct === undefined
        ? null
        : applyRule(() => parseWeight(dto.weightPct ?? ''));

    const updated = await this.serializable(async (tx) => {
      if (newWeight) {
        await this.assertWeightsFit(
          tx,
          existing.courseId,
          existing.period,
          newWeight,
          existing.id,
        );
      }
      return tx.activity.update({
        where: { id: existing.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(newWeight ? { weightPct: newWeight.toFixed(2) } : {}),
        },
      });
    });
    return toActivityView(updated);
  }

  // --- Grades -------------------------------------------------------------

  async setGrade(
    actor: AuthUser,
    gradeId: string,
    rawValue: string | null,
    ip?: string,
  ): Promise<GradeView> {
    const value =
      rawValue === null ? null : applyRule(() => parseGrade(rawValue));

    const grade = await this.prisma.grade.findFirst({
      where: {
        id: gradeId,
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
    });
    if (!grade) throw new AppError(404, 'NOT_FOUND', 'Nota no encontrada.');

    const before = grade.value ? new Decimal(grade.value.toString()) : null;
    const unchanged =
      before === null || value === null
        ? before === value
        : before.equals(value);
    if (unchanged) return toGradeView(grade);

    const updated = await this.prisma.grade.update({
      where: { id: grade.id },
      data: { value: value ? value.toFixed(2) : null },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'GRADE_UPDATE',
      resource: 'grade',
      resourceId: grade.id,
      ip,
      diff: {
        activityId: grade.activityId,
        studentId: grade.studentId,
        from: before ? before.toFixed(2) : null,
        to: value ? value.toFixed(2) : null,
      },
    });
    return toGradeView(updated);
  }

  // --- Gradebook ----------------------------------------------------------

  async gradebook(
    actor: AuthUser,
    courseId: string,
    requestedPeriod?: string,
  ): Promise<GradebookView> {
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
      },
      select: { period: true, maxAbsences: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');
    const period = requestedPeriod?.trim() || course.period;
    const threshold = this.config.values.ABSENCE_ALERT_THRESHOLD_PCT;
    const absencesByStudent = await this.attendance.absencesByStudent(
      actor.institutionId,
      courseId,
    );

    const [activities, enrollments] = await Promise.all([
      this.prisma.activity.findMany({
        where: {
          courseId,
          period,
          institutionId: actor.institutionId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.enrollment.findMany({
        where: {
          courseId,
          institutionId: actor.institutionId,
          deletedAt: null,
          student: { deletedAt: null },
        },
        include: { student: true },
      }),
    ]);
    const students = enrollments
      .map((e) => e.student)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const grades = await this.loadGrades(
      actor.institutionId,
      activities.map((a) => a.id),
      students.map((s) => s.id),
    );

    const weightsTotal = sumWeights(
      activities.map((a) => a.weightPct.toString()),
    );
    const weightsComplete = weightsTotal.equals(WEIGHT_TOTAL);

    const rows = students.map<GradebookRow>((student) => {
      const cells: Record<string, string | null> = {};
      const gradeIds: Record<string, string> = {};
      const graded: WeightedItem[] = [];

      for (const activity of activities) {
        const grade = grades.get(`${activity.id}:${student.id}`);
        if (!grade) continue;
        gradeIds[activity.id] = grade.id;
        const value = grade.value ? new Decimal(grade.value.toString()) : null;
        cells[activity.id] = value ? value.toFixed(2) : null;
        if (value) {
          graded.push({ value, weightPct: activity.weightPct.toString() });
        }
      }

      const isFinal =
        weightsComplete &&
        activities.length > 0 &&
        graded.length === activities.length;
      const partial = isFinal ? null : partialWeightedAverage(graded);
      const average = isFinal
        ? weightedAverage(graded)
        : (partial?.average ?? null);
      const gradedWeight = isFinal
        ? WEIGHT_TOTAL
        : (partial?.coveredWeightPct ?? new Decimal(0));

      const absences = absencesByStudent.get(student.id) ?? 0;
      const absenceAlert = shouldAlert(absences, course.maxAbsences, threshold);

      return {
        studentId: student.id,
        studentCode: student.code,
        studentName: student.fullName,
        grades: cells,
        gradeIds,
        average: average ? average.toFixed(2) : null,
        isFinal,
        gradedWeightPct: gradedWeight.toFixed(2),
        absences,
        absenceAlert,
        atRisk: isGradeAtRisk(average) || absenceAlert,
      };
    });

    return {
      period,
      weightsTotal: weightsTotal.toFixed(2),
      weightsComplete,
      activities: activities.map(toActivityView),
      rows,
    };
  }

  // --- Helpers ------------------------------------------------------------

  /**
   * Grades of the enrolled students, creating the empty ones that are missing
   * (students enrolled after the activity was created). Idempotent.
   */
  private async loadGrades(
    institutionId: string,
    activityIds: string[],
    studentIds: string[],
  ): Promise<Map<string, { id: string; value: Prisma.Decimal | null }>> {
    const key = (activityId: string, studentId: string) =>
      `${activityId}:${studentId}`;
    if (activityIds.length === 0 || studentIds.length === 0) return new Map();

    const fetch = () =>
      this.prisma.grade.findMany({
        where: {
          institutionId,
          activityId: { in: activityIds },
          studentId: { in: studentIds },
        },
        select: { id: true, activityId: true, studentId: true, value: true },
      });

    let rows = await fetch();
    if (rows.length < activityIds.length * studentIds.length) {
      const existing = new Set(rows.map((r) => key(r.activityId, r.studentId)));
      const missing = activityIds.flatMap((activityId) =>
        studentIds
          .filter((studentId) => !existing.has(key(activityId, studentId)))
          .map((studentId) => ({ institutionId, activityId, studentId })),
      );
      await this.prisma.grade.createMany({
        data: missing,
        skipDuplicates: true,
      });
      rows = await fetch();
    }
    return new Map(rows.map((r) => [key(r.activityId, r.studentId), r]));
  }

  /** The period's weights can never add up to more than 100. */
  private async assertWeightsFit(
    tx: Prisma.TransactionClient,
    courseId: string,
    period: string,
    weight: Decimal,
    excludeActivityId: string | null,
  ): Promise<void> {
    const others = await tx.activity.aggregate({
      where: {
        courseId,
        period,
        deletedAt: null,
        ...(excludeActivityId ? { id: { not: excludeActivityId } } : {}),
      },
      _sum: { weightPct: true },
    });
    const used = new Decimal(others._sum.weightPct?.toString() ?? '0');
    const total = used.plus(weight);
    if (total.greaterThan(WEIGHT_TOTAL)) {
      throw new AppError(
        409,
        'WEIGHTS_EXCEED_100',
        `Los porcentajes del periodo sumarían ${total.toFixed(2)} %; el máximo es 100 %.`,
      );
    }
  }

  /** Serializable so two concurrent requests cannot both pass the 100 % check. */
  private async serializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new AppError(
          409,
          'CONFLICT',
          'Otro cambio simultáneo afectó los porcentajes. Intenta de nuevo.',
        );
      }
      throw error;
    }
  }
}
