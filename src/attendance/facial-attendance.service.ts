import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { AiRunner } from '../ai/ai-runner.service';
import { FaceRecognitionPort } from '../ai/ports/face-recognition.port';
import { faceRecognitionOutput } from '../ai/schemas/ai-output.schemas';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { AppConfig } from '../config/app-config';
import { FaceReferenceService } from '../consent/face-reference.service';
import { isSupportedImage } from '../consent/image';
import { classifyFaceMatch } from '../domain/attendance-rules';
import { JobQueue } from '../jobs/job-queue';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceSessionView, PhotoSessionQueryDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';

const RECOGNIZE_JOB = 'attendance.recognize';

interface RecognizeJob {
  sessionId: string;
  userId: string;
  /** Held in memory only for the life of the job; never written anywhere (D22). */
  image: Buffer;
}

/**
 * Attendance from a group photo. The AI only proposes: matches above the
 * threshold become PRESENT, everything else UNRECOGNIZED (never ABSENT), and
 * the teacher reviews and confirms through the same flow as manual sessions.
 */
@Injectable()
export class FacialAttendanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FacialAttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly attendance: AttendanceService,
    private readonly references: FaceReferenceService,
    private readonly faces: FaceRecognitionPort,
    private readonly ai: AiRunner,
    private readonly jobs: JobQueue,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.register<RecognizeJob>(RECOGNIZE_JOB, (job) =>
      this.recognize(job),
    );
    void this.recoverInterrupted();
  }

  // --- Request ------------------------------------------------------------

  /** Returns a PROCESSING session; recognition runs in the background (poll GET). */
  async start(
    actor: AuthUser,
    query: PhotoSessionQueryDto,
    image: Buffer,
  ): Promise<AttendanceSessionView> {
    const course = await this.prisma.course.findFirst({
      where: {
        id: query.courseId,
        institutionId: actor.institutionId,
        teacherId: actor.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!course) throw new AppError(404, 'NOT_FOUND', 'Curso no encontrado.');

    if (!isSupportedImage(image, this.config.values.AI_PROVIDER === 'fake')) {
      throw new AppError(
        400,
        'INVALID_IMAGE',
        'Envía una imagen JPEG o PNG (Content-Type image/jpeg o image/png).',
      );
    }
    const day = this.attendance.resolveDay(query.date);

    const session = await this.prisma.attendanceSession.create({
      data: {
        institutionId: actor.institutionId,
        courseId: course.id,
        createdById: actor.id,
        date: new Date(`${day}T00:00:00.000Z`),
        status: SessionStatus.PROCESSING,
        mode: 'PHOTO',
      },
    });
    await this.jobs.enqueue<RecognizeJob>(
      RECOGNIZE_JOB,
      { sessionId: session.id, userId: actor.id, image },
      session.id,
    );
    return this.attendance.getSession(actor, session.id);
  }

  // --- Background job -----------------------------------------------------

  /**
   * Never throws. Any failure leaves the session in MANUAL_REQUIRED with every
   * student listed as UNRECOGNIZED, so the teacher can mark them by hand.
   */
  private async recognize(job: RecognizeJob): Promise<void> {
    try {
      const session = await this.prisma.attendanceSession.findUnique({
        where: { id: job.sessionId },
        select: { id: true, institutionId: true, courseId: true, status: true },
      });
      if (!session || session.status !== SessionStatus.PROCESSING) return;

      const studentIds = await this.enrolledStudentIds(session);
      // Only students with a consent in force AND a stored reference.
      const candidates = await this.references.candidatesFor(
        session.institutionId,
        studentIds,
      );
      if (candidates.length === 0) {
        await this.toManual(session.id, session.institutionId, studentIds);
        return;
      }

      const result = await this.ai.run({
        kind: 'FACE_RECOGNITION',
        institutionId: session.institutionId,
        userId: job.userId,
        provider: this.faces.provider,
        schema: faceRecognitionOutput,
        call: () => this.faces.recognize({ image: job.image, candidates }),
      });

      const threshold = this.config.values.FACE_MATCH_THRESHOLD;
      const eligible = new Set(candidates.map((c) => c.studentId));

      // Best confidence per student; ids the provider invented are ignored.
      const best = new Map<string, number>();
      for (const match of result.matches) {
        if (!eligible.has(match.studentId)) continue;
        best.set(
          match.studentId,
          Math.max(best.get(match.studentId) ?? 0, match.confidence),
        );
      }

      const records: Prisma.AttendanceRecordCreateManyInput[] = studentIds.map(
        (studentId) => {
          const confidence = best.get(studentId);
          if (!eligible.has(studentId)) {
            // No consent or reference: nobody looked for this student.
            return {
              institutionId: session.institutionId,
              sessionId: session.id,
              studentId,
              status: 'UNRECOGNIZED',
              source: 'MANUAL',
            };
          }
          return {
            institutionId: session.institutionId,
            sessionId: session.id,
            studentId,
            status:
              confidence === undefined
                ? 'UNRECOGNIZED'
                : classifyFaceMatch(confidence, threshold),
            source: 'AI',
            confidence: confidence === undefined ? null : confidence.toFixed(3),
          };
        },
      );

      const recognized = records.filter(
        (r) => r.status === 'PRESENT' && r.source === 'AI',
      ).length;

      await this.prisma.$transaction([
        this.prisma.attendanceRecord.createMany({
          data: records,
          skipDuplicates: true,
        }),
        this.prisma.attendanceSession.updateMany({
          where: { id: session.id, status: SessionStatus.PROCESSING },
          data: {
            status: SessionStatus.READY,
            facesNotMatched: result.unrecognizedFaces,
            // What the AI proposed, frozen before the teacher corrects anything.
            aiRecognized: recognized,
            aiUnrecognized: candidates.length - recognized,
            notConsidered: studentIds.length - candidates.length,
          },
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Facial attendance ${job.sessionId} fell back to manual (${
          error instanceof Error ? error.name : 'unknown error'
        })`,
      );
      await this.failToManual(job.sessionId);
    }
  }

  private async enrolledStudentIds(session: {
    institutionId: string;
    courseId: string;
  }): Promise<string[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        courseId: session.courseId,
        institutionId: session.institutionId,
        deletedAt: null,
        student: { deletedAt: null },
      },
      select: { studentId: true },
    });
    return enrollments.map((e) => e.studentId);
  }

  private async failToManual(sessionId: string): Promise<void> {
    try {
      const session = await this.prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        select: { id: true, institutionId: true, courseId: true },
      });
      if (!session) return;
      await this.toManual(
        session.id,
        session.institutionId,
        await this.enrolledStudentIds(session),
      );
    } catch (error) {
      this.logger.error(
        `Could not move session ${sessionId} to MANUAL_REQUIRED`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  /** Lists everyone as UNRECOGNIZED/MANUAL so the teacher can fill them in. */
  private async toManual(
    sessionId: string,
    institutionId: string,
    studentIds: string[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.attendanceRecord.createMany({
        data: studentIds.map((studentId) => ({
          institutionId,
          sessionId,
          studentId,
          status: 'UNRECOGNIZED' as const,
          source: 'MANUAL' as const,
        })),
        skipDuplicates: true,
      }),
      this.prisma.attendanceSession.updateMany({
        where: { id: sessionId, status: SessionStatus.PROCESSING },
        data: { status: SessionStatus.MANUAL_REQUIRED },
      }),
    ]);
  }

  /**
   * The photo was only in memory, so a restart cannot resume the recognition:
   * sessions left PROCESSING go to manual mode and the teacher may retake the photo.
   */
  private async recoverInterrupted(): Promise<void> {
    try {
      const stuck = await this.prisma.attendanceSession.findMany({
        where: { status: SessionStatus.PROCESSING },
        select: { id: true },
      });
      for (const { id } of stuck) await this.failToManual(id);
      if (stuck.length > 0) {
        this.logger.log(
          `Moved ${stuck.length} interrupted facial session(s) to manual mode`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Could not recover interrupted facial sessions',
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}
