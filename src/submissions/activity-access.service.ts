import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

/** Ownership check shared by rubrics and submissions: the activity belongs to the teacher's course. */
@Injectable()
export class ActivityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Foreign or missing activities both answer 404 (D11). */
  async findOwned(actor: AuthUser, activityId: string) {
    const activity = await this.prisma.activity.findFirst({
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
      select: { id: true, courseId: true, name: true },
    });
    if (!activity) {
      throw new AppError(404, 'NOT_FOUND', 'Actividad no encontrada.');
    }
    return activity;
  }
}
