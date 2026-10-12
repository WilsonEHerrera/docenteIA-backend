import { Injectable, Logger } from '@nestjs/common';

export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

/**
 * Background work, kept off the user's request. In-memory today; a BullMQ
 * implementation can replace it later without touching the modules.
 */
export abstract class JobQueue {
  abstract register<T>(name: string, handler: JobHandler<T>): void;

  /**
   * Idempotent per `jobId`: returns false when a job with that id is already
   * waiting or running (so double clicks do not process twice).
   */
  abstract enqueue<T>(
    name: string,
    payload: T,
    jobId: string,
  ): Promise<boolean>;
}

interface QueuedJob {
  key: string;
  name: string;
  payload: unknown;
}

const CONCURRENCY = 2;

/**
 * Jobs are lost if the process restarts, so the owner of a job must keep its
 * state in the database (e.g. a PROCESSING session) and recover it on boot.
 * Handlers own their failures: an exception here is only logged.
 */
@Injectable()
export class InMemoryJobQueue extends JobQueue {
  private readonly logger = new Logger(InMemoryJobQueue.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly waiting: QueuedJob[] = [];
  private readonly inFlight = new Set<string>();
  private running = 0;

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler);
  }

  enqueue<T>(name: string, payload: T, jobId: string): Promise<boolean> {
    if (!this.handlers.has(name)) {
      return Promise.reject(
        new Error(`No handler registered for job "${name}"`),
      );
    }
    const key = `${name}:${jobId}`;
    if (this.inFlight.has(key)) return Promise.resolve(false);

    this.inFlight.add(key);
    this.waiting.push({ key, name, payload });
    this.pump();
    return Promise.resolve(true);
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.waiting.length > 0) {
      const job = this.waiting.shift();
      if (!job) return;
      this.running += 1;
      // Next tick: never run the job inside the request that enqueued it.
      setImmediate(() => {
        void this.execute(job).finally(() => {
          this.running -= 1;
          this.inFlight.delete(job.key);
          this.pump();
        });
      });
    }
  }

  private async execute(job: QueuedJob): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) return;
    try {
      await handler(job.payload);
    } catch (error) {
      this.logger.error(
        `Job ${job.key} failed`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}
