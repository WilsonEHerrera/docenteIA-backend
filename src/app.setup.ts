import { INestApplication, ValidationPipe } from '@nestjs/common';
import { text } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

export function configureApp(app: INestApplication, origins: string[]): void {
  app.use(helmet());
  // CSV import sends the file as the raw body (no multipart dependency).
  app.use(
    '/api/v1/courses/import',
    text({ type: ['text/csv', 'text/plain'], limit: '1mb' }),
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
