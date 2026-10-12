import { Injectable } from '@nestjs/common';
import { Prisma, Role, SessionStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { mean, percentage } from '../domain/statistics';
import { GradebookView } from '../grades/grades.dto';
import { GradesService } from '../grades/grades.service';
import { PrismaService } from '../prisma/prisma.service';
import { CsvValue, toCsv } from './csv-writer';
import {
  AttendanceReport,
  AttendanceReportRow,
  ExportQueryDto,
  PerformanceReport,
} from './reports.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UTF8_BOM = String.fromCharCode(0xfeff);

interface OwnedCourse {
  id: string;
  name: string;
  period: string;
}

export interface CsvExport {
  filename: string;
  content: string;
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'curso';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grades: GradesService,
    private readonly audit: AuditService,
  ) {}

  // --- Performance --------------------------------------------------------

  async performance(
    actor: AuthUser,
    courseId: string,
    period?: string,
  ): Promise<PerformanceReport> {
    return (await this.buildPerformance(actor, courseId, period)).report;
  }

  private async buildPerformance(
    actor: AuthUser,
    courseId: string,
    period?: string,
  ): Promise<{ report: PerformanceReport; book: GradebookView }> {
    const course = await this.ownedCourse(actor, courseId);
    const book = await this.grades.gradebook(actor, course.id, period);

    const averages = book.rows.flatMap((r) => (r.average ? [r.average] : []));
    const courseAverage = mean(averages);

    const activities = book.activities.map((activity) => {
      const values = book.rows.flatMap((row) => {
        const value = row.grades[activity.id];
        return value ? [value] : [];
      });
      const average = mean(values);
      return {
        id: activity.id,
        name: activity.name,
        weightPct: activity.weightPct,
        gradedCount: values.length,
        average: average ? average.toFixed(2) : null,
      };
    });

    const atRisk = book.rows.filter((r) => r.atRisk);
    const report: PerformanceReport = {
      course: { id: course.id, name: course.name },
      period: book.period,
      weightsTotal: book.weightsTotal,
      weightsComplete: book.weightsComplete,
      studentCount: book.rows.length,
      gradedStudents: averages.length,
      courseAverage: courseAverage ? courseAverage.toFixed(2) : null,
      belowPassing: book.rows.filter(
        (r) => r.average !== null && new Decimal(r.average).lessThan(3),
      ).length,
      absenceAlerts: book.rows.filter((r) => r.absenceAlert).length,
      atRiskCount: atRisk.length,
      activities,
      atRiskStudents: atRisk.map((r) => ({
        studentId: r.studentId,
        studentCode: r.studentCode,
        studentName: r.studentName,
        average: r.average,
        absences: r.absences,
        absenceAlert: r.absenceAlert,
      })),
    };
    return { report, book };
  }

  // --- Attendance ---------------------------------------------------------

  async attendance(
    actor: AuthUser,
    courseId: string,
    from?: string,
    to?: string,
  ): Promise<AttendanceReport> {
    const course = await this.ownedCourse(actor, courseId);
    const fromDay = from ? this.parseDay(from) : null;
    const toDay = to ? this.parseDay(to) : null;
    if (fromDay && toDay && fromDay > toDay) {
      throw new AppError(
        400,
        'INVALID_RANGE',
        'La fecha inicial no puede ser posterior a la final.',
      );
    }

    const sessionWhere: Prisma.AttendanceSessionWhereInput = {
      courseId: course.id,
      institutionId: actor.institutionId,
      status: SessionStatus.CONFIRMED,
      ...(fromDay || toDay
        ? {
            date: {
              ...(fromDay ? { gte: fromDay } : {}),
              ...(toDay ? { lte: toDay } : {}),
            },
          }
        : {}),
    };

    const [enrollments, confirmedSessions, grouped] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          courseId: course.id,
          institutionId: actor.institutionId,
          deletedAt: null,
          student: { deletedAt: null },
        },
        include: { student: true },
      }),
      this.prisma.attendanceSession.count({ where: sessionWhere }),
      this.prisma.attendanceRecord.groupBy({
        by: ['studentId', 'status'],
        where: { institutionId: actor.institutionId, session: sessionWhere },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, Record<string, number>>();
    for (const g of grouped) {
      const entry = counts.get(g.studentId) ?? {};
      entry[g.status] = g._count._all;
      counts.set(g.studentId, entry);
    }

    let totalPresent = 0;
    let totalAbsent = 0;
    const rows = enrollments
      .map(({ student }) => {
        const c = counts.get(student.id) ?? {};
        const present = c.PRESENT ?? 0;
        const absent = c.ABSENT ?? 0;
        totalPresent += present;
        totalAbsent += absent;
        const pct = percentage(present, present + absent);
        return {
          studentId: student.id,
          studentCode: student.code,
          studentName: student.fullName,
          present,
          absent,
          excused: c.EXCUSED ?? 0,
          attendancePct: pct ? pct.toFixed(1) : null,
        } satisfies AttendanceReportRow;
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));

    const overall = percentage(totalPresent, totalPresent + totalAbsent);
    return {
      course: { id: course.id, name: course.name },
      from: from ?? null,
      to: to ?? null,
      confirmedSessions,
      overallAttendancePct: overall ? overall.toFixed(1) : null,
      rows,
    };
  }

  // --- CSV export ---------------------------------------------------------

  async export(
    actor: AuthUser,
    query: ExportQueryDto,
    ip?: string,
  ): Promise<CsvExport> {
    const rows: CsvValue[][] = [];
    let filename: string;

    if (query.type === 'performance') {
      const { report, book } = await this.buildPerformance(
        actor,
        query.courseId,
        query.period,
      );
      rows.push([
        'Código',
        'Estudiante',
        ...book.activities.map((a) => `${a.name} (${a.weightPct} %)`),
        'Promedio',
        'Definitivo',
        'Fallas',
        'Alerta de fallas',
        'En riesgo',
      ]);
      for (const row of book.rows) {
        rows.push([
          row.studentCode,
          row.studentName,
          ...book.activities.map((a) => row.grades[a.id] ?? ''),
          row.average ?? '',
          row.isFinal ? 'Sí' : 'No',
          row.absences,
          row.absenceAlert ? 'Sí' : 'No',
          row.atRisk ? 'Sí' : 'No',
        ]);
      }
      filename = `notas-${slug(report.course.name)}-${slug(report.period)}.csv`;
    } else {
      const report = await this.attendance(
        actor,
        query.courseId,
        query.from,
        query.to,
      );
      rows.push([
        'Código',
        'Estudiante',
        'Presente',
        'Ausente',
        'Excusa',
        '% asistencia',
      ]);
      for (const row of report.rows) {
        rows.push([
          row.studentCode,
          row.studentName,
          row.present,
          row.absent,
          row.excused,
          row.attendancePct ?? '',
        ]);
      }
      filename = `asistencia-${slug(report.course.name)}.csv`;
    }

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'REPORT_EXPORT',
      resource: 'report',
      resourceId: query.courseId,
      ip,
      diff: { type: query.type, format: 'csv', rows: rows.length - 1 },
    });

    // BOM so Excel reads the file as UTF-8 (accents and ñ).
    return { filename, content: UTF8_BOM + toCsv(rows) };
  }

  // --- Helpers ------------------------------------------------------------

  /** A TEACHER only reaches their own courses; COORDINATOR any in the institution. Foreign → 404. */
  private async ownedCourse(
    actor: AuthUser,
    courseId: string,
  ): Promise<OwnedCourse> {
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
        ...(actor.role === Role.TEACHER ? { teacherId: actor.id } : {}),
      },
      select: { id: true, name: true, period: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');
    return course;
  }

  private parseDay(day: string): Date {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (
      !DAY.test(day) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day
    ) {
      throw new AppError(400, 'INVALID_DATE', 'La fecha no es válida.');
    }
    return parsed;
  }
}
