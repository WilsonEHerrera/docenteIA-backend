import { Module } from '@nestjs/common';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AttendanceModule } from '../attendance/attendance.module';
import { GradesController } from './grades.controller';
import { GradesService } from './grades.service';

@Module({
  imports: [AttendanceModule],
  controllers: [GradesController],
  providers: [GradesService, CourseOwnershipGuard],
  exports: [GradesService],
})
export class GradesModule {}
