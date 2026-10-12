import { Injectable, Logger } from '@nestjs/common';
import { ConsentPurpose } from '@prisma/client';
import { AiRunner } from '../ai/ai-runner.service';
import {
  FaceRecognitionPort,
  FaceRef,
} from '../ai/ports/face-recognition.port';
import { faceEnrollmentOutput } from '../ai/schemas/ai-output.schemas';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { FieldCipher } from '../security/field-cipher';
import { FaceReferenceView } from './consent.dto';
import { isSupportedImage } from './image';
import { StudentAccessService } from './student-access.service';

const PURPOSE = ConsentPurpose.FACIAL_ATTENDANCE;

@Injectable()
export class FaceReferenceService {
  private readonly logger = new Logger(FaceReferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: StudentAccessService,
    private readonly cipher: FieldCipher,
    private readonly ai: AiRunner,
    private readonly faces: FaceRecognitionPort,
    private readonly config: AppConfig,
  ) {}

  /**
   * Stores the encrypted facial representation of a student. The photo is
   * processed in memory and discarded; without a consent in force nothing is
   * sent to the AI at all.
   */
  async register(
    actor: AuthUser,
    studentId: string,
    image: Buffer,
    ip?: string,
  ): Promise<FaceReferenceView> {
    await this.access.assertCanActFor(actor, studentId);

    if (!isSupportedImage(image, this.config.values.AI_PROVIDER === 'fake')) {
      throw new AppError(
        400,
        'INVALID_IMAGE',
        'Envía una imagen JPEG o PNG (Content-Type image/jpeg o image/png).',
      );
    }
    if (!this.cipher.configured) {
      throw new AppError(
        503,
        'BIOMETRIC_NOT_CONFIGURED',
        'El almacenamiento biométrico no está configurado.',
      );
    }

    const consent = await this.prisma.biometricConsent.findFirst({
      where: {
        studentId,
        institutionId: actor.institutionId,
        purpose: PURPOSE,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!consent) {
      throw new AppError(
        409,
        'CONSENT_REQUIRED',
        'El estudiante no tiene un consentimiento biométrico vigente.',
      );
    }

    const { embedding } = await this.ai.run({
      kind: 'FACE_ENROLLMENT',
      institutionId: actor.institutionId,
      userId: actor.id,
      provider: this.faces.provider,
      schema: faceEnrollmentOutput,
      call: () => this.faces.enroll({ image }),
    });

    const embeddingEnc = this.cipher.encrypt(
      JSON.stringify(embedding),
      studentId,
    );
    const saved = await this.prisma.faceReference.upsert({
      where: { studentId },
      update: { embeddingEnc, consentId: consent.id },
      create: {
        institutionId: actor.institutionId,
        studentId,
        consentId: consent.id,
        embeddingEnc,
      },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'FACE_REFERENCE_REGISTER',
      resource: 'face_reference',
      resourceId: saved.id,
      ip,
      diff: { studentId, consentId: consent.id, provider: this.faces.provider },
    });
    return { studentId, registeredAt: saved.updatedAt.toISOString() };
  }

  /** Removes the reference without touching the consent. */
  async remove(actor: AuthUser, studentId: string, ip?: string): Promise<void> {
    await this.access.assertCanActFor(actor, studentId);
    const { count } = await this.prisma.faceReference.deleteMany({
      where: { studentId, institutionId: actor.institutionId },
    });
    await this.audit.record({
      institutionId: actor.institutionId,
      userId: actor.id,
      action: 'FACE_REFERENCE_DELETE',
      resource: 'face_reference',
      resourceId: studentId,
      ip,
      diff: { deleted: count > 0 },
    });
  }

  /**
   * Recognition candidates: only students with BOTH a consent in force and a
   * stored reference. Everyone else is left out and must be marked by hand.
   * A reference that cannot be decrypted is skipped, never guessed.
   */
  async candidatesFor(
    institutionId: string,
    studentIds: string[],
  ): Promise<FaceRef[]> {
    if (studentIds.length === 0 || !this.cipher.configured) return [];

    const [consents, references] = await Promise.all([
      this.prisma.biometricConsent.findMany({
        where: {
          institutionId,
          studentId: { in: studentIds },
          purpose: PURPOSE,
          revokedAt: null,
        },
        select: { studentId: true },
      }),
      this.prisma.faceReference.findMany({
        where: { institutionId, studentId: { in: studentIds } },
        select: { studentId: true, embeddingEnc: true },
      }),
    ]);
    const consented = new Set(consents.map((c) => c.studentId));

    const candidates: FaceRef[] = [];
    for (const reference of references) {
      if (!consented.has(reference.studentId)) continue;
      try {
        const parsed = faceEnrollmentOutput.shape.embedding.safeParse(
          JSON.parse(
            this.cipher.decrypt(reference.embeddingEnc, reference.studentId),
          ),
        );
        if (parsed.success) {
          candidates.push({
            studentId: reference.studentId,
            embedding: parsed.data,
          });
        }
      } catch {
        this.logger.warn(
          `Skipping unreadable facial reference of student ${reference.studentId}`,
        );
      }
    }
    return candidates;
  }
}
