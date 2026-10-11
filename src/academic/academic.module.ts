import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicService } from './academic.service';
import { CourseOwnershipGuard } from './course-ownership.guard';

@Module({
  controllers: [AcademicController],
  providers: [AcademicService, CourseOwnershipGuard],
})
export class AcademicModule {}
