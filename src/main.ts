import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const { PORT, CORS_ORIGINS } = app.get(AppConfig).values;
  configureApp(app, CORS_ORIGINS);
  await app.listen(PORT);
}

void bootstrap();
