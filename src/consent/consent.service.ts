import { Injectable } from '@nestjs/common';
import { ConsentPurpose, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConsentView,
  CourseConsentRow,
  GrantConsentDto,
  GuardianStudentView,
  GuardianView,
  StudentConsentStatus,
} from './consent.dto';
import { StudentAccessService } from './student-access.service';

const DEFAULT_PURPOSE = ConsentPurpose.FACIAL_ATTENDANCE;

const toConsentView = (consent: {
  id: string;
  purpose: ConsentPurpose;
  grantedAt: Date;
  grantedByRole: Role;
  revokedAt: Date | null;
}): ConsentView => ({
  id: consent.id,
  purpose: consent.purpose,
  grantedAt: consent.grantedAt.toISOString(),
  grantedByRole: consent.grantedByRole,
  revokedAt: consent.revokedAt?.toISOString() ?? null,
});

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: StudentAccessService,
  ) {}

  // --- Consent ------------------------------------------------------------

  /** Idempotent: granting while a consent is in force returns that consent. */
  async grant(
    actor: AuthUser,
    studentId: string,
    dto: GrantConsentDto,
    ip?: string,
  ): Promise<ConsentView> {
    await this.access.assertCanActFor(actor, studentId);
    if (!dto.accepted) {
      throw new AppError(
        400,
        'CONSENT_NOT_ACCEPTED',
        'El consentimiento solo se registra cuando es aceptado.',
      );
    }

    const current = await this.prisma.biometricConsent.findFirst({
      where: {
        studentId,
        institutionId: actor.institutionId,
        purpose: dto.purpose,
        revokedAt: null,
      },
    });
    if (current) return toConsentView(current);

    const consent = await this.prisma.biometricConsent.create({
      data: {
        institutionId: actor.institutionId,
        studentId,
        purpose: dto.purpose,
        grantedById: actor.id,
        grantedByRole: actor.role,
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'CONSENT_GRANT',
      resource: 'biometric_consent',
      resourceId: consent.id,
      ip,
      diff: {
        studentId,
        purpose: dto.purpose,
        grantedByRole: actor.role,
      },
    });
    return toConsentView(consent);
  }

  /**
   * Revoking deletes the student's facial reference for real (not a soft
   * delete). The consent row itself is kept as the legal record.
   */
  async revoke(
    actor: AuthUser,
    studentId: string,
    purpose: ConsentPurpose = DEFAULT_PURPOSE,
    ip?: string,
  ): Promise<void> {
    await this.access.assertCanActFor(actor, studentId);

    // FACIAL_ATTENDANCE is the only purpose that uses the facial reference.
    const { revoked, deleted } = await this.prisma.$transaction(async (tx) => {
      const consents = await tx.biometricConsent.updateMany({
        where: {
          studentId,
          institutionId: actor.institutionId,
          purpose,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });
      const references = await tx.faceReference.deleteMany({
        where: { studentId, institutionId: actor.institutionId },
      });
      return { revoked: consents.count, deleted: references.count };
    });

    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'CONSENT_REVOKE',
      resource: 'biometric_consent',
      resourceId: studentId,
      ip,
      diff: {
        purpose,
        consentsRevoked: revoked,
        faceReferenceDeleted: deleted > 0,
      },
    });
  }

  async status(
    actor: AuthUser,
    studentId: string,
  ): Promise<StudentConsentStatus> {
    const student = await this.access.assertCanActFor(actor, studentId);
    const [consents, reference] = await Promise.all([
      this.prisma.biometricConsent.findMany({
        where: {
          studentId,
          institutionId: actor.institutionId,
          purpose: DEFAULT_PURPOSE,
        },
        orderBy: { grantedAt: 'desc' },
      }),
      this.prisma.faceReference.findUnique({
        where: { studentId },
        select: { id: true },
      }),
    ]);
    return {
      studentId: student.id,
      studentCode: student.code,
      studentName: student.fullName,
      purpose: DEFAULT_PURPOSE,
      active: consents.some((c) => c.revokedAt === null),
      hasFaceReference: reference !== null,
      consents: consents.map(toConsentView),
    };
  }

  /** For the teacher: who will be recognized and who must be marked by hand. */
  async courseOverview(
    actor: AuthUser,
    courseId: string,
  ): Promise<CourseConsentRow[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        courseId,
        institutionId: actor.institutionId,
        deletedAt: null,
        student: { deletedAt: null },
      },
      include: { student: true },
    });
    const ids = enrollments.map((e) => e.studentId);

    const [consents, references] = await Promise.all([
      this.prisma.biometricConsent.findMany({
        where: {
          institutionId: actor.institutionId,
          studentId: { in: ids },
          purpose: DEFAULT_PURPOSE,
          revokedAt: null,
        },
        select: { studentId: true },
      }),
      this.prisma.faceReference.findMany({
        where: { institutionId: actor.institutionId, studentId: { in: ids } },
        select: { studentId: true },
      }),
    ]);
    const withConsent = new Set(consents.map((c) => c.studentId));
    const withReference = new Set(references.map((r) => r.studentId));

    return enrollments
      .map(({ student }) => {
        const hasConsent = withConsent.has(student.id);
        const hasFaceReference = withReference.has(student.id);
        return {
          studentId: student.id,
          studentCode: student.code,
          studentName: student.fullName,
          hasConsent,
          hasFaceReference,
          eligible: hasConsent && hasFaceReference,
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }

  // --- Guardians ----------------------------------------------------------

  async listGuardians(
    actor: AuthUser,
    studentId: string,
  ): Promise<GuardianView[]> {
    await this.access.assertCanActFor(actor, studentId);
    const links = await this.prisma.studentGuardian.findMany({
      where: { studentId, institutionId: actor.institutionId },
      include: { guardian: true },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((link) => ({
      userId: link.guardianId,
      fullName: link.guardian.fullName,
      email: link.guardian.email,
    }));
  }

  async linkGuardian(
    actor: AuthUser,
    studentId: string,
    userId: string,
    ip?: string,
  ): Promise<GuardianView> {
    await this.access.assertCanActFor(actor, studentId);
    const guardian = await this.prisma.user.findFirst({
      where: {
        id: userId,
        institutionId: actor.institutionId,
        role: Role.GUARDIAN,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, fullName: true, email: true },
    });
    if (!guardian) {
      throw new AppError(
        400,
        'INVALID_GUARDIAN',
        'El usuario no existe o no tiene rol de acudiente.',
      );
    }

    await this.prisma.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
      update: {},
      create: {
        institutionId: actor.institutionId,
        studentId,
        guardianId: guardian.id,
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'GUARDIAN_LINK',
      resource: 'student',
      resourceId: studentId,
      ip,
      diff: { guardianId: guardian.id },
    });
    return {
      userId: guardian.id,
      fullName: guardian.fullName,
      email: guardian.email,
    };
  }

  async unlinkGuardian(
    actor: AuthUser,
    studentId: string,
    userId: string,
    ip?: string,
  ): Promise<void> {
    await this.access.assertCanActFor(actor, studentId);
    await this.prisma.studentGuardian.deleteMany({
      where: {
        studentId,
        guardianId: userId,
        institutionId: actor.institutionId,
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'GUARDIAN_UNLINK',
      resource: 'student',
      resourceId: studentId,
      ip,
      diff: { guardianId: userId },
    });
  }

  /** The guardian's own students, with the state of each one's consent. */
  async myStudents(actor: AuthUser): Promise<GuardianStudentView[]> {
    const links = await this.prisma.studentGuardian.findMany({
      where: { guardianId: actor.id, institutionId: actor.institutionId },
      include: {
        student: {
          include: {
            faceReference: { select: { id: true } },
            consents: {
              where: { purpose: DEFAULT_PURPOSE, revokedAt: null },
              select: { id: true },
            },
          },
        },
      },
    });
    return links
      .filter((link) => link.student.deletedAt === null)
      .map(({ student }) => ({
        studentId: student.id,
        studentCode: student.code,
        studentName: student.fullName,
        consentActive: student.consents.length > 0,
        hasFaceReference: student.faceReference !== null,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
}
