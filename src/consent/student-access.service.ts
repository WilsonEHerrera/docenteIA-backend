import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Who may act on a student's biometric data: an ADMIN of the institution, or a
 * GUARDIAN explicitly linked to that student. Anyone else gets 404 (D11).
 */
@Injectable()
export class StudentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanActFor(actor: AuthUser, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        institutionId: actor.institutionId,
        deletedAt: null,
      },
      select: { id: true, code: true, fullName: true },
    });
    if (!student) {
      throw new AppError(404, 'NOT_FOUND', 'Estudiante no encontrado.');
    }

    if (actor.role === Role.GUARDIAN) {
      const link = await this.prisma.studentGuardian.findUnique({
        where: {
          studentId_guardianId: { studentId, guardianId: actor.id },
        },
        select: { id: true },
      });
      if (!link) {
        throw new AppError(404, 'NOT_FOUND', 'Estudiante no encontrado.');
      }
    }
    return student;
  }
}
