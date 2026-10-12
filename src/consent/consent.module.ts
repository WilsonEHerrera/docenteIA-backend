import { Module } from '@nestjs/common';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AiModule } from '../ai/ai.module';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { FaceReferenceService } from './face-reference.service';
import { StudentAccessService } from './student-access.service';

@Module({
  imports: [AiModule],
  controllers: [ConsentController],
  providers: [
    StudentAccessService,
    ConsentService,
    FaceReferenceService,
    CourseOwnershipGuard,
  ],
  // Facial attendance (3.3) asks for the consented, enrolled candidates.
  exports: [FaceReferenceService],
})
export class ConsentModule {}
