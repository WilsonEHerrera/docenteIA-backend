import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { applyRule } from '../common/apply-rule';
import { AuthUser } from '../common/types';
import {
  DomainRuleError,
  parseGrade,
  parseWeight,
  sumWeights,
  WEIGHT_TOTAL,
} from '../domain/weighted-average';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityAccessService } from './activity-access.service';
import { storedLevels } from './evaluation';
import { RubricView, UpsertRubricDto } from './submissions.dto';

const rubricInclude = {
  criteria: { orderBy: { position: 'asc' } },
} satisfies Prisma.RubricInclude;

type RubricWithCriteria = Prisma.RubricGetPayload<{
  include: typeof rubricInclude;
}>;

export const toRubricView = (rubric: RubricWithCriteria): RubricView => ({
  id: rubric.id,
  activityId: rubric.activityId,
  criteria: rubric.criteria.map((criterion) => {
    const levels = storedLevels.safeParse(criterion.levels);
    return {
      id: criterion.id,
      name: criterion.name,
      weightPct: criterion.weightPct.toString(),
      levels: levels.success ? levels.data : [],
    };
  }),
});

@Injectable()
export class RubricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ActivityAccessService,
  ) {}

  async get(actor: AuthUser, activityId: string): Promise<RubricView> {
    const activity = await this.access.findOwned(actor, activityId);
    const rubric = await this.prisma.rubric.findUnique({
      where: { activityId: activity.id },
      include: rubricInclude,
    });
    if (!rubric) throw new AppError(404, 'NOT_FOUND', 'Rúbrica no encontrada.');
    return toRubricView(rubric);
  }

  /** Creates or replaces the rubric. Once work has been submitted it is frozen. */
  async upsert(
    actor: AuthUser,
    activityId: string,
    dto: UpsertRubricDto,
  ): Promise<RubricView> {
    const activity = await this.access.findOwned(actor, activityId);

    const criteria = applyRule(() => {
      const names = new Set<string>();
      const parsed = dto.criteria.map((criterion) => {
        const name = criterion.name.trim();
        if (names.has(name.toLowerCase())) {
          throw new AppError(
            400,
            'DUPLICATE_CRITERION',
            `El criterio "${name}" está repetido.`,
          );
        }
        names.add(name.toLowerCase());

        const levelNames = new Set<string>();
        const levels = criterion.levels.map((level) => {
          const levelName = level.name.trim();
          if (levelNames.has(levelName.toLowerCase())) {
            throw new AppError(
              400,
              'DUPLICATE_LEVEL',
              `El nivel "${levelName}" está repetido en "${name}".`,
            );
          }
          levelNames.add(levelName.toLowerCase());
          return {
            name: levelName,
            score: parseGrade(level.score).toFixed(2),
          };
        });
        return {
          name,
          weightPct: parseWeight(criterion.weightPct),
          levels,
        };
      });

      const total = sumWeights(parsed.map((c) => c.weightPct.toString()));
      if (!total.equals(WEIGHT_TOTAL)) {
        throw new DomainRuleError(
          'WEIGHTS_NOT_100',
          `Los porcentajes de los criterios deben sumar 100 (suman ${total.toString()}).`,
        );
      }
      return parsed;
    });

    const inUse = await this.prisma.submission.count({
      where: { activityId: activity.id },
    });
    if (inUse > 0) {
      throw new AppError(
        409,
        'RUBRIC_IN_USE',
        'La rúbrica ya se usó en entregas y no puede modificarse.',
      );
    }

    const rubric = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.rubric.upsert({
        where: { activityId: activity.id },
        update: {},
        create: { institutionId: actor.institutionId, activityId: activity.id },
      });
      await tx.rubricCriterion.deleteMany({ where: { rubricId: saved.id } });
      await tx.rubricCriterion.createMany({
        data: criteria.map((criterion, position) => ({
          rubricId: saved.id,
          name: criterion.name,
          weightPct: criterion.weightPct.toFixed(2),
          position,
          levels: criterion.levels,
        })),
      });
      return tx.rubric.findUniqueOrThrow({
        where: { id: saved.id },
        include: rubricInclude,
      });
    });
    return toRubricView(rubric);
  }
}
