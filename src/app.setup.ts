import { INestApplication, ValidationPipe } from '@nestjs/common';
import { raw, text } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

export function configureApp(app: INestApplication, origins: string[]): void {
  app.use(helmet());
  // CSV import sends the file as the raw body (no multipart dependency).
  app.use(
    '/api/v1/courses/import',
    text({ type: ['text/csv', 'text/plain'], limit: '1mb' }),
  );
  // Reference photos arrive as the raw body; only these types are parsed.
  app.use(
    '/api/v1/students',
    raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }),
  );
  // Group photo for facial attendance (body is the raw image).
  app.use(
    '/api/v1/attendance/sessions',
    raw({ type: ['image/jpeg', 'image/png'], limit: '10mb' }),
  );
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
