import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ActivityAccessService } from './activity-access.service';
import { RubricsService } from './rubrics.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AiModule],
  controllers: [SubmissionsController],
  providers: [ActivityAccessService, RubricsService, SubmissionsService],
})
export class SubmissionsModule {}
