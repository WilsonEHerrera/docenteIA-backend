import { Module } from '@nestjs/common';
import { AiMetricsController } from './ai-metrics.controller';
import { AiMetricsService } from './ai-metrics.service';

@Module({
  controllers: [AiMetricsController],
  providers: [AiMetricsService],
})
export class AiMetricsModule {}
