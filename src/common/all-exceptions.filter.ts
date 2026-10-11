import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { TracedRequest } from './trace-id.middleware';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'Solicitud inválida.',
  401: 'No autenticado.',
  403: 'No tienes permiso para esta acción.',
  404: 'Recurso no encontrado.',
  409: 'Conflicto con el estado actual del recurso.',
  429: 'Demasiadas solicitudes.',
};

const INTERNAL_MESSAGE = 'Error interno del servidor.';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<TracedRequest>();
    const res = http.getResponse<Response>();
    const traceId = req.traceId ?? 'unknown';

    const body = this.toBody(exception, traceId);

    if (body.statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `[${traceId}] ${req.method} ${req.originalUrl.split('?')[0]} -> ${body.statusCode}`,
        stack,
      );
    } else {
      this.logger.warn(
        `[${traceId}] ${req.method} ${req.originalUrl.split('?')[0]} -> ${body.statusCode} ${body.code}`,
      );
    }

    res.status(body.statusCode).json(body);
  }

  private prismaCode(exception: unknown): string | undefined {
    if (
      exception instanceof Error &&
      exception.name === 'PrismaClientKnownRequestError'
    ) {
      const { code } = exception as Error & { code?: unknown };
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  private toBody(exception: unknown, traceId: string): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const raw =
        typeof response === 'object' && response !== null
          ? (response as {
              message?: string | string[];
              code?: string;
            })
          : {};

      // Explicit application errors (AppError) carry their own code/message.
      if (
        statusCode < 500 &&
        typeof raw.code === 'string' &&
        typeof raw.message === 'string'
      ) {
        return { statusCode, code: raw.code, message: raw.message, traceId };
      }

      const isValidation =
        statusCode === 400 && Array.isArray(raw.message) && raw.message.length;

      if (isValidation) {
        return {
          statusCode,
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos.',
          details: raw.message,
          traceId,
        };
      }
      return {
        statusCode,
        code: CODE_BY_STATUS[statusCode] ?? 'HTTP_ERROR',
        message:
          MESSAGE_BY_STATUS[statusCode] ??
          (statusCode >= 500 ? INTERNAL_MESSAGE : 'Error en la solicitud.'),
        traceId,
      };
    }

    const prismaCode = this.prismaCode(exception);
    if (prismaCode === 'P2002') {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: MESSAGE_BY_STATUS[409],
        traceId,
      };
    }
    if (prismaCode === 'P2025') {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: MESSAGE_BY_STATUS[404],
        traceId,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: INTERNAL_MESSAGE,
      traceId,
    };
  }
}
