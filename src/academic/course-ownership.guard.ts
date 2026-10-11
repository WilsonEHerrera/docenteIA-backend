import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthedRequest } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Second authorization level for `:id` course routes: same institution, and a
 * TEACHER must own the course. Foreign courses answer 404 so IDs cannot be probed.
 */
@Injectable()
export class CourseOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    const params = req.params as Record<string, string | undefined>;
    const courseId = params.id;
    if (!user || !courseId || !UUID.test(courseId))
      throw new NotFoundException();

    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        institutionId: user.institutionId,
        deletedAt: null,
        ...(user.role === Role.TEACHER ? { teacherId: user.id } : {}),
      },
      select: { id: true },
    });
    if (!course) throw new NotFoundException();
    return true;
  }
}
