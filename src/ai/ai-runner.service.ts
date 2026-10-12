import { Injectable, Logger } from '@nestjs/common';
import { AiCallKind } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { backoffDelayMs, startOfBogotaDay } from './backoff';

export type AiErrorCode = 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT';

/**
 * The AI could not answer (503) or the institution used up its daily quota (429).
 * Callers turn this into the manual-mode path; it is never a reason to stop the system.
 */
export class AiUnavailableError extends AppError {
  constructor(
    readonly reason: AiErrorCode | 'DAILY_LIMIT',
    message: string,
  ) {
    super(
      reason === 'DAILY_LIMIT' ? 429 : 503,
      reason === 'DAILY_LIMIT' ? 'AI_DAILY_LIMIT' : 'AI_UNAVAILABLE',
      message,
    );
  }
}

class AiTimeoutError extends Error {}

export interface AiRunOptions<T> {
  kind: AiCallKind;
  institutionId: string;
  userId?: string;
  provider: string;
  promptVersion?: string;
  /** Provider output must satisfy this schema or the attempt counts as failed. */
  schema: z.ZodType<T>;
  call: () => Promise<unknown>;
}

/**
 * Single door to every AI provider: daily quota, timeout, retries with backoff,
 * output validation and an AiCallLog row per operation. It never stores or
 * logs prompts, images, student text or provider error messages.
 */
@Injectable()
export class AiRunner {
  private readonly logger = new Logger(AiRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async run<T>(options: AiRunOptions<T>): Promise<T> {
    await this.assertWithinDailyLimit(options.institutionId);

    const { AI_TIMEOUT_MS, AI_MAX_RETRIES } = this.config.values;
    const startedAt = Date.now();
    let reason: AiErrorCode = 'PROVIDER_ERROR';

    for (let attempt = 1; attempt <= AI_MAX_RETRIES; attempt++) {
      try {
        const raw = await this.withTimeout(options.call(), AI_TIMEOUT_MS);
        const parsed = options.schema.safeParse(raw);
        if (parsed.success) {
          await this.log(options, true, attempt, startedAt, null);
          return parsed.data;
        }
        reason = 'INVALID_OUTPUT';
      } catch (error) {
        reason = error instanceof AiTimeoutError ? 'TIMEOUT' : 'PROVIDER_ERROR';
      }
      if (attempt < AI_MAX_RETRIES) await this.sleep(backoffDelayMs(attempt));
    }

    await this.log(options, false, AI_MAX_RETRIES, startedAt, reason);
    throw new AiUnavailableError(
      reason,
      'El servicio de IA no está disponible. Continúa en modo manual.',
    );
  }

  /** Soft limit: two simultaneous calls can slightly overshoot it. */
  private async assertWithinDailyLimit(institutionId: string): Promise<void> {
    const limit = this.config.values.AI_DAILY_LIMIT_PER_INSTITUTION;
    if (limit <= 0) return;
    const used = await this.prisma.aiCallLog.count({
      where: {
        institutionId,
        createdAt: { gte: startOfBogotaDay(new Date()) },
      },
    });
    if (used >= limit) {
      throw new AiUnavailableError(
        'DAILY_LIMIT',
        'La institución alcanzó el límite diario de uso de IA.',
      );
    }
  }

  private withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AiTimeoutError()), timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Never throws: a logging failure must not turn a good AI answer into an error. */
  private async log<T>(
    options: AiRunOptions<T>,
    success: boolean,
    attempts: number,
    startedAt: number,
    errorCode: AiErrorCode | null,
  ): Promise<void> {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          institutionId: options.institutionId,
          userId: options.userId ?? null,
          kind: options.kind,
          provider: options.provider,
          promptVersion: options.promptVersion ?? null,
          success,
          attempts,
          latencyMs: Date.now() - startedAt,
          errorCode,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not write AiCallLog (${options.kind})`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}
