import { Module } from '@nestjs/common';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AiModule } from '../ai/ai.module';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

@Module({
  imports: [AiModule],
  controllers: [QuizzesController],
  providers: [QuizzesService, CourseOwnershipGuard],
})
export class QuizzesModule {}
