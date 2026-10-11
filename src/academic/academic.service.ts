import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import {
  Paginated,
  paginated,
  PaginationQueryDto,
  skipTake,
} from '../common/pagination';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CourseDetailView,
  CourseView,
  CreateCourseDto,
  CreateScheduleDto,
  CreateStudentDto,
  CreateSubjectDto,
  ImportReport,
  ImportRowError,
} from './academic.dto';
import { parseCsv } from './csv';

const MAX_IMPORT_ROWS = 2000;
const EXPECTED_HEADER = ['course', 'studentcode', 'fullname', 'email'];
const CODE = /^[A-Za-z0-9_-]{1,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const courseInclude = {
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, fullName: true } },
  _count: { select: { enrollments: { where: { deletedAt: null } } } },
} satisfies Prisma.CourseInclude;

type CourseWithRelations = Prisma.CourseGetPayload<{
  include: typeof courseInclude;
}>;

const toCourseView = (course: CourseWithRelations): CourseView => ({
  id: course.id,
  name: course.name,
  period: course.period,
  maxAbsences: course.maxAbsences,
  subject: course.subject,
  teacher: course.teacher,
  enrolledCount: course._count.enrollments,
});

@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Subjects -----------------------------------------------------------

  async listSubjects(actor: AuthUser) {
    const rows = await this.prisma.subject.findMany({
      where: { institutionId: actor.institutionId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, code: s.code }));
  }

  async createSubject(actor: AuthUser, dto: CreateSubjectDto) {
    const subject = await this.prisma.subject.create({
      data: {
        institutionId: actor.institutionId,
        name: dto.name.trim(),
        code: dto.code,
      },
    });
    return { id: subject.id, name: subject.name, code: subject.code };
  }

  // --- Courses ------------------------------------------------------------

  async listCourses(
    actor: AuthUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<CourseView>> {
    const where: Prisma.CourseWhereInput = {
      institutionId: actor.institutionId,
      deletedAt: null,
      ...(actor.role === Role.TEACHER ? { teacherId: actor.id } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.course.findMany({
        where,
        include: courseInclude,
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.course.count({ where }),
    ]);
    return paginated(rows.map(toCourseView), total, query);
  }

  /** Ownership is enforced by CourseOwnershipGuard; the institution filter stays as defense in depth. */
  async getCourse(actor: AuthUser, id: string): Promise<CourseDetailView> {
    const course = await this.prisma.course.findFirst({
      where: { id, institutionId: actor.institutionId, deletedAt: null },
      include: {
        ...courseInclude,
        schedules: {
          where: { deletedAt: null },
          orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        },
        enrollments: {
          where: { deletedAt: null },
          include: { student: true },
        },
      },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');

    return {
      ...toCourseView(course),
      schedules: course.schedules.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
      })),
      students: course.enrollments
        .map((e) => ({
          id: e.student.id,
          code: e.student.code,
          fullName: e.student.fullName,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  }

  async createCourse(
    actor: AuthUser,
    dto: CreateCourseDto,
  ): Promise<CourseView> {
    const [subject, teacher] = await Promise.all([
      this.prisma.subject.findFirst({
        where: {
          id: dto.subjectId,
          institutionId: actor.institutionId,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          id: dto.teacherId,
          institutionId: actor.institutionId,
          role: Role.TEACHER,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
    ]);
    if (!subject) {
      throw new AppError(400, 'INVALID_SUBJECT', 'La asignatura no existe.');
    }
    if (!teacher) {
      throw new AppError(
        400,
        'INVALID_TEACHER',
        'El docente no existe o no está activo.',
      );
    }

    const course = await this.prisma.course.create({
      data: {
        institutionId: actor.institutionId,
        subjectId: dto.subjectId,
        teacherId: dto.teacherId,
        name: dto.name.trim(),
        period: dto.period.trim(),
        ...(dto.maxAbsences ? { maxAbsences: dto.maxAbsences } : {}),
      },
      include: courseInclude,
    });
    return toCourseView(course);
  }

  async createSchedule(
    actor: AuthUser,
    courseId: string,
    dto: CreateScheduleDto,
  ) {
    if (dto.startTime >= dto.endTime) {
      throw new AppError(
        400,
        'INVALID_TIME_RANGE',
        'La hora de inicio debe ser anterior a la de fin.',
      );
    }
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');

    const schedule = await this.prisma.schedule.create({
      data: {
        institutionId: actor.institutionId,
        courseId,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
        room: dto.room?.trim() || null,
      },
    });
    return {
      id: schedule.id,
      weekday: schedule.weekday,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      room: schedule.room,
    };
  }

  // --- Students & enrollment ---------------------------------------------

  async createStudent(actor: AuthUser, dto: CreateStudentDto) {
    const student = await this.prisma.student.create({
      data: {
        institutionId: actor.institutionId,
        code: dto.code,
        fullName: dto.fullName.trim(),
        email: dto.email?.trim().toLowerCase() ?? null,
      },
    });
    return { id: student.id, code: student.code, fullName: student.fullName };
  }

  async enroll(actor: AuthUser, courseId: string, studentCode: string) {
    const [course, student] = await Promise.all([
      this.prisma.course.findFirst({
        where: {
          id: courseId,
          institutionId: actor.institutionId,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.student.findFirst({
        where: {
          institutionId: actor.institutionId,
          code: studentCode,
          deletedAt: null,
        },
        select: { id: true },
      }),
    ]);
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'El estudiante no existe.');
    }

    const enrollment = await this.prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId, studentId: student.id } },
      update: { deletedAt: null },
      create: {
        institutionId: actor.institutionId,
        courseId,
        studentId: student.id,
      },
    });
    return { id: enrollment.id, courseId, studentId: student.id };
  }

  // --- CSV import ---------------------------------------------------------

  /**
   * Columns: course,studentCode,fullName,email. Each valid row is applied on its
   * own; invalid rows are reported with their line number and do not stop the import.
   */
  async importEnrollments(
    actor: AuthUser,
    csv: string,
    ip?: string,
  ): Promise<ImportReport> {
    const rows = parseCsv(csv);
    const report: ImportReport = {
      totalRows: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      studentsCreated: 0,
      errors: [],
    };
    if (rows.length === 0) {
      throw new AppError(400, 'EMPTY_CSV', 'El archivo CSV está vacío.');
    }

    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    if (EXPECTED_HEADER.some((name, i) => header[i] !== name)) {
      throw new AppError(
        400,
        'INVALID_CSV_HEADER',
        'La primera fila debe ser: course,studentCode,fullName,email',
      );
    }
    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        400,
        'CSV_TOO_LARGE',
        `El archivo supera el máximo de ${MAX_IMPORT_ROWS} filas.`,
      );
    }
    report.totalRows = dataRows.length;

    const courses = await this.prisma.course.findMany({
      where: { institutionId: actor.institutionId, deletedAt: null },
      select: { id: true, name: true },
    });
    const coursesByName = new Map<string, string[]>();
    for (const course of courses) {
      const key = course.name.trim().toLowerCase();
      coursesByName.set(key, [...(coursesByName.get(key) ?? []), course.id]);
    }

    // Header is line 1, so data row i is line i + 2 in the user's file.
    for (const [index, cells] of dataRows.entries()) {
      const line = index + 2;
      const error = await this.importRow(actor, cells, coursesByName, report);
      if (error)
        report.errors.push({
          row: line,
          message: error,
        } satisfies ImportRowError);
    }

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'ENROLLMENT_IMPORT',
      resource: 'course',
      ip,
      diff: {
        totalRows: report.totalRows,
        enrolled: report.enrolled,
        studentsCreated: report.studentsCreated,
        errors: report.errors.length,
      },
    });
    return report;
  }

  /** Returns an error message for the row, or null when it was applied. */
  private async importRow(
    actor: AuthUser,
    cells: string[],
    coursesByName: Map<string, string[]>,
    report: ImportReport,
  ): Promise<string | null> {
    const [courseName = '', code = '', fullName = '', email = ''] = cells.map(
      (cell) => cell.trim(),
    );

    if (!courseName) return 'El curso es obligatorio.';
    if (!CODE.test(code)) {
      return 'El código del estudiante es inválido (letras, números, - o _; máx. 32).';
    }
    if (fullName.length < 2 || fullName.length > 120) {
      return 'El nombre del estudiante debe tener entre 2 y 120 caracteres.';
    }
    if (email && !EMAIL.test(email)) return 'El correo no es válido.';

    const matches = coursesByName.get(courseName.toLowerCase()) ?? [];
    if (matches.length === 0) return `El curso "${courseName}" no existe.`;
    if (matches.length > 1) {
      return `Hay varios cursos llamados "${courseName}"; renómbralos para importar.`;
    }
    const courseId = matches[0];

    try {
      let student = await this.prisma.student.findFirst({
        where: { institutionId: actor.institutionId, code, deletedAt: null },
        select: { id: true },
      });
      if (!student) {
        student = await this.prisma.student.create({
          data: {
            institutionId: actor.institutionId,
            code,
            fullName,
            email: email ? email.toLowerCase() : null,
          },
          select: { id: true },
        });
        report.studentsCreated += 1;
      }

      const existing = await this.prisma.enrollment.findUnique({
        where: { courseId_studentId: { courseId, studentId: student.id } },
      });
      if (existing && !existing.deletedAt) {
        report.alreadyEnrolled += 1;
        return null;
      }
      await this.prisma.enrollment.upsert({
        where: { courseId_studentId: { courseId, studentId: student.id } },
        update: { deletedAt: null },
        create: {
          institutionId: actor.institutionId,
          courseId,
          studentId: student.id,
        },
      });
      report.enrolled += 1;
      return null;
    } catch {
      return 'No se pudo guardar la fila.';
    }
  }
}
