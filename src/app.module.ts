import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AcademicModule } from './academic/academic.module';
import { AiMetricsModule } from './ai-metrics/ai-metrics.module';
import { AiModule } from './ai/ai.module';
import { ConsentModule } from './consent/consent.module';
import { JobsModule } from './jobs/jobs.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { traceIdMiddleware } from './common/trace-id.middleware';
import { JwtAuthGuard, RolesGuard, ThrottleGuard } from './common/guards';
import { AppConfigModule } from './config/app-config';
import { GradesModule } from './grades/grades.module';
import { HealthModule } from './health/health.module';
import { InstitutionsModule } from './institutions/institutions.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { ReportsModule } from './reports/reports.module';
import { SecurityModule } from './security/security.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    SecurityModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    InstitutionsModule,
    AcademicModule,
    GradesModule,
    AttendanceModule,
    ReportsModule,
    JobsModule,
    AiModule,
    SubmissionsModule,
    ConsentModule,
    QuizzesModule,
    AiMetricsModule,
  ],
  providers: [
    // Order matters: throttle first, then authenticate, then authorize by role.
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(traceIdMiddleware).forRoutes('*path');
  }
}
