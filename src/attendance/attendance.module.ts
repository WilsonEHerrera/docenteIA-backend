import { Module } from '@nestjs/common';
import { CourseOwnershipGuard } from '../academic/course-ownership.guard';
import { AiModule } from '../ai/ai.module';
import { ConsentModule } from '../consent/consent.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { FacialAttendanceService } from './facial-attendance.service';

@Module({
  imports: [AiModule, ConsentModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, FacialAttendanceService, CourseOwnershipGuard],
  exports: [AttendanceService],
})
export class AttendanceModule {}
