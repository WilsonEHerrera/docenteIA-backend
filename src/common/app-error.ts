import { HttpException } from '@nestjs/common';

/** HTTP error carrying a stable machine-readable `code` and a Spanish message. */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}
