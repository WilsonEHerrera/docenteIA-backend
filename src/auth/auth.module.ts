import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  LoggingPasswordResetNotifier,
  PasswordResetNotifier,
} from './password-reset-notifier';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: PasswordResetNotifier, useClass: LoggingPasswordResetNotifier },
  ],
})
export class AuthModule {}
