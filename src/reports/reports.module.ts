import { Module } from '@nestjs/common';
import { GradesModule } from '../grades/grades.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [GradesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
