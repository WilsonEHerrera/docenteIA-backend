import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { AiMetricsQueryDto, AiMetricsView } from './ai-metrics.dto';
import { AiMetricsService } from './ai-metrics.service';

@Controller('ai')
@Roles(Role.ADMIN, Role.COORDINATOR)
export class AiMetricsController {
  constructor(private readonly metrics: AiMetricsService) {}

  @Get('metrics')
  get(
    @CurrentUser() actor: AuthUser,
    @Query() query: AiMetricsQueryDto,
  ): Promise<AiMetricsView> {
    return this.metrics.metrics(actor, query.from, query.to);
  }
}
