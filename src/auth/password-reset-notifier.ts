import { Injectable, Logger } from '@nestjs/common';

export interface PasswordResetMessage {
  userId: string;
  email: string;
  token: string;
}

/** Delivery port for reset links. The real mail adapter arrives with `notifications` (Fase 2). */
export abstract class PasswordResetNotifier {
  abstract send(message: PasswordResetMessage): Promise<void>;
}

/** Default: records that a reset was requested, never the token itself. */
@Injectable()
export class LoggingPasswordResetNotifier extends PasswordResetNotifier {
  private readonly logger = new Logger('PasswordReset');

  send(message: PasswordResetMessage): Promise<void> {
    this.logger.warn(
      `Reset requested for user ${message.userId}; no mail provider configured yet`,
    );
    return Promise.resolve();
  }
}
