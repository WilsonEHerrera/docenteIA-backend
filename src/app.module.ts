import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AcademicModule } from './academic/academic.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { traceIdMiddleware } from './common/trace-id.middleware';
import { JwtAuthGuard, RolesGuard, ThrottleGuard } from './common/guards';
import { AppConfigModule } from './config/app-config';
import { HealthModule } from './health/health.module';
import { InstitutionsModule } from './institutions/institutions.module';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './security/security.module';
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
