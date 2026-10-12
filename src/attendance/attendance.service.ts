import { Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma, SessionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import {
  Paginated,
  paginated,
  PaginationQueryDto,
  skipTake,
} from '../common/pagination';
import { AuthUser } from '../common/types';
import { AppConfig } from '../config/app-config';
import { absenceUsagePct, shouldAlert } from '../domain/absence-alert';
import { hasUnresolvedRecords } from '../domain/attendance-rules';
import { PrismaService } from '../prisma/prisma.service';
import {
  AttendanceRecordView,
  AttendanceSessionSummaryView,
  AttendanceSessionView,
  AttendanceStats,
  AttendanceSummaryRow,
  AttendanceSummaryView,
  CreateManualSessionDto,
} from './attendance.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const sessionInclude = {
  records: { include: { student: true } },
} satisfies Prisma.AttendanceSessionInclude;

type SessionWithRecords = Prisma.AttendanceSessionGetPayload<{
  include: typeof sessionInclude;
}>;

const toDay = (date: Date): string => date.toISOString().slice(0, 10);

const statsOf = (statuses: AttendanceStatus[]): AttendanceStats => ({
  present: statuses.filter((s) => s === 'PRESENT').length,
  absent: statuses.filter((s) => s === 'ABSENT').length,
  excused: statuses.filter((s) => s === 'EXCUSED').length,
  unrecognized: statuses.filter((s) => s === 'UNRECOGNIZED').length,
});

const toSessionView = (session: SessionWithRecords): AttendanceSessionView => ({
  id: session.id,
  courseId: session.courseId,
  date: toDay(session.date),
  status: session.status,
  confirmedAt: session.confirmedAt?.toISOString() ?? null,
  facesNotMatched: session.facesNotMatched,
  records: session.records
    .map<AttendanceRecordView>((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentCode: r.student.code,
      studentName: r.student.fullName,
      status: r.status,
      source: r.source,
      confidence: r.confidence ? Number(r.confidence.toString()) : null,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName)),
  stats: statsOf(session.records.map((r) => r.status)),
});

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // --- Sessions -----------------------------------------------------------

  /** Manual mode: the teacher marks every enrolled student; no AI involved. */
  async createManual(
    actor: AuthUser,
    dto: CreateManualSessionDto,
  ): Promise<AttendanceSessionView> {
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

    const day = this.resolveDay(dto.date);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        courseId: course.id,
        institutionId: actor.institutionId,
        deletedAt: null,
        student: { deletedAt: null },
      },
      select: { studentId: true },
    });
    const enrolled = new Set(enrollments.map((e) => e.studentId));
    const sent = dto.records.map((r) => r.studentId);
    const unique = new Set(sent);
    const unknown = sent.filter((id) => !enrolled.has(id));
    const missing = [...enrolled].filter((id) => !unique.has(id));

    if (unique.size !== sent.length) {
      throw new AppError(
        400,
        'DUPLICATE_RECORDS',
        'Hay estudiantes repetidos en la lista.',
      );
    }
    if (unknown.length > 0) {
      throw new AppError(
        400,
        'STUDENT_NOT_ENROLLED',
        'La lista incluye estudiantes que no están matriculados en el curso.',
      );
    }
    if (missing.length > 0) {
      throw new AppError(
        400,
        'INCOMPLETE_RECORDS',
        `Falta registrar la asistencia de ${missing.length} estudiante(s).`,
      );
    }

    const session = await this.prisma.attendanceSession.create({
      data: {
        institutionId: actor.institutionId,
        courseId: course.id,
        createdById: actor.id,
        date: new Date(`${day}T00:00:00.000Z`),
        status: SessionStatus.READY,
        records: {
          create: dto.records.map((r) => ({
            institutionId: actor.institutionId,
            studentId: r.studentId,
            status: r.status,
            source: 'MANUAL' as const,
          })),
        },
      },
      include: sessionInclude,
    });
    return toSessionView(session);
  }

  async getSession(
    actor: AuthUser,
    sessionId: string,
  ): Promise<AttendanceSessionView> {
    const session = await this.findOwnedSession(actor, sessionId);
    return toSessionView(session);
  }

  async updateRecord(
    actor: AuthUser,
    sessionId: string,
    recordId: string,
    status: AttendanceStatus,
    ip?: string,
  ): Promise<AttendanceRecordView> {
    const session = await this.findOwnedSession(actor, sessionId);
    if (session.status === SessionStatus.CONFIRMED) {
      throw new AppError(
        409,
        'SESSION_CONFIRMED',
        'La sesión ya fue confirmada y no se puede modificar.',
      );
    }
    const record = session.records.find((r) => r.id === recordId);
    if (!record)
      throw new AppError(404, 'NOT_FOUND', 'Registro no encontrado.');

    if (record.status !== status || record.source !== 'MANUAL') {
      await this.prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { status, source: 'MANUAL' },
      });
      if (record.status !== status) {
        await this.audit.record({
          institutionId: actor.institutionId,
          userId: actor.id,
          action: 'ATTENDANCE_RECORD_UPDATE',
          resource: 'attendance_record',
          resourceId: record.id,
          ip,
          diff: {
            sessionId,
            studentId: record.studentId,
            from: record.status,
            to: status,
          },
        });
      }
    }
    return {
      id: record.id,
      studentId: record.studentId,
      studentCode: record.student.code,
      studentName: record.student.fullName,
      status,
      source: 'MANUAL',
      confidence: record.confidence
        ? Number(record.confidence.toString())
        : null,
    };
  }

  /** Closes the session: from here on its absences count and it becomes read-only. */
  async confirm(
    actor: AuthUser,
    sessionId: string,
  ): Promise<AttendanceSessionView> {
    const session = await this.findOwnedSession(actor, sessionId);
    if (session.status === SessionStatus.CONFIRMED) {
      throw new AppError(
        409,
        'SESSION_CONFIRMED',
        'La sesión ya fue confirmada.',
      );
    }
    if (hasUnresolvedRecords(session.records.map((r) => r.status))) {
      throw new AppError(
        409,
        'UNRESOLVED_RECORDS',
        'Hay estudiantes sin reconocer; corrígelos antes de confirmar.',
      );
    }

    // Guarded update so two concurrent confirmations cannot both succeed.
    const { count } = await this.prisma.attendanceSession.updateMany({
      where: { id: session.id, status: { not: SessionStatus.CONFIRMED } },
      data: { status: SessionStatus.CONFIRMED, confirmedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(
        409,
        'SESSION_CONFIRMED',
        'La sesión ya fue confirmada.',
      );
    }
    return toSessionView(await this.findOwnedSession(actor, sessionId));
  }

  async listSessions(
    actor: AuthUser,
    courseId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<AttendanceSessionSummaryView>> {
    const where: Prisma.AttendanceSessionWhereInput = {
      courseId,
      institutionId: actor.institutionId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where,
        include: { records: { select: { status: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.attendanceSession.count({ where }),
    ]);
    return paginated(
      rows.map((s) => ({
        id: s.id,
        date: toDay(s.date),
        status: s.status,
        confirmedAt: s.confirmedAt?.toISOString() ?? null,
        stats: statsOf(s.records.map((r) => r.status)),
      })),
      total,
      query,
    );
  }

  // --- Absence count & alerts --------------------------------------------

  /** Panel view: absences per student (confirmed sessions only) and who reached the alert threshold. */
  async summary(
    actor: AuthUser,
    courseId: string,
  ): Promise<AttendanceSummaryView> {
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
      },
      select: { maxAbsences: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');

    const [enrollments, confirmedSessions, grouped] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          courseId,
          institutionId: actor.institutionId,
          deletedAt: null,
          student: { deletedAt: null },
        },
        include: { student: true },
      }),
      this.prisma.attendanceSession.count({
        where: {
          courseId,
          institutionId: actor.institutionId,
          status: SessionStatus.CONFIRMED,
        },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['studentId', 'status'],
        where: {
          institutionId: actor.institutionId,
          status: { in: ['ABSENT', 'EXCUSED'] },
          session: { courseId, status: SessionStatus.CONFIRMED },
        },
        _count: { _all: true },
      }),
    ]);

    const absences = new Map<string, number>();
    const excused = new Map<string, number>();
    for (const g of grouped) {
      const target = g.status === 'ABSENT' ? absences : excused;
      target.set(g.studentId, g._count._all);
    }

    const threshold = this.config.values.ABSENCE_ALERT_THRESHOLD_PCT;
    const rows = enrollments
      .map<AttendanceSummaryRow>(({ student }) => {
        const count = absences.get(student.id) ?? 0;
        return {
          studentId: student.id,
          studentCode: student.code,
          studentName: student.fullName,
          absences: count,
          excused: excused.get(student.id) ?? 0,
          maxAbsences: course.maxAbsences,
          usagePct: absenceUsagePct(count, course.maxAbsences),
          alert: shouldAlert(count, course.maxAbsences, threshold),
        };
      })
      .sort(
        (a, b) =>
          b.absences - a.absences || a.studentName.localeCompare(b.studentName),
      );

    return {
      maxAbsences: course.maxAbsences,
      alertThresholdPct: threshold,
      confirmedSessions,
      rows,
    };
  }

  /** studentId → unexcused absences in confirmed sessions of the course. */
  async absencesByStudent(
    institutionId: string,
    courseId: string,
  ): Promise<Map<string, number>> {
    const grouped = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId'],
      where: {
        institutionId,
        status: 'ABSENT',
        session: { courseId, status: SessionStatus.CONFIRMED },
      },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.studentId, g._count._all]));
  }

  // --- Helpers ------------------------------------------------------------

  /** Today in Colombia (UTC-5, no DST) unless a date is given; real dates only, never in the future. */
  resolveDay(requested?: string): string {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
    }).format(new Date());
    const day = requested ?? today;

    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (
      !DAY.test(day) ||
      Number.isNaN(parsed.getTime()) ||
      toDay(parsed) !== day
    ) {
      throw new AppError(400, 'INVALID_DATE', 'La fecha no es válida.');
    }
    if (day > today) {
      throw new AppError(
        400,
        'FUTURE_DATE',
        'No se puede registrar asistencia de una fecha futura.',
      );
    }
    return day;
  }

  private async findOwnedSession(
    actor: AuthUser,
    sessionId: string,
  ): Promise<SessionWithRecords> {
    const session = await this.prisma.attendanceSession.findFirst({
      where: {
        id: sessionId,
        institutionId: actor.institutionId,
        course: {
          institutionId: actor.institutionId,
          teacherId: actor.id,
          deletedAt: null,
        },
      },
      include: sessionInclude,
    });
    if (!session) throw new AppError(404, 'NOT_FOUND', 'Sesión no encontrada.');
    return session;
  }
}
