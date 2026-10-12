import { Injectable } from '@nestjs/common';
import { AiCallKind, Prisma, SessionStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/types';
import { mean, percentage, percentile } from '../domain/statistics';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiCallMetrics,
  AiMetricsView,
  DecisionMetrics,
} from './ai-metrics.dto';

/** Safety cap per query; the response says so when it is hit. */
const ROW_CAP = 50_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_OFFSET = '-05:00';
const DAY_MS = 24 * 60 * 60 * 1000;

const pct = (part: number, total: number): string | null => {
  const value = percentage(part, total);
  return value ? value.toFixed(1) : null;
};

const decisions = (counts: {
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
}): DecisionMetrics => {
  const decided = counts.approved + counts.edited + counts.rejected;
  return {
    total: decided + counts.pending,
    ...counts,
    acceptedRatePct: pct(counts.approved, decided),
    correctedRatePct: pct(counts.edited + counts.rejected, decided),
  };
};

@Injectable()
export class AiMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(
    actor: AuthUser,
    from?: string,
    to?: string,
  ): Promise<AiMetricsView> {
    const createdAt = this.resolveRange(from, to);
    const institutionId = actor.institutionId;
    const inRange = createdAt ? { createdAt } : {};

    const [callRows, suggestionCounts, edited, questionCounts, sessions] =
      await Promise.all([
        this.prisma.aiCallLog.findMany({
          where: { institutionId, ...inRange },
          select: {
            kind: true,
            success: true,
            attempts: true,
            latencyMs: true,
            errorCode: true,
            costUsd: true,
          },
          take: ROW_CAP + 1,
        }),
        this.prisma.aiSuggestion.groupBy({
          by: ['status'],
          // Suggestions replaced by a re-upload are REJECTED with no teacher: not a rejection.
          where: {
            institutionId,
            ...inRange,
            OR: [
              { status: { not: 'REJECTED' } },
              { decidedById: { not: null } },
            ],
          },
          _count: { _all: true },
        }),
        this.prisma.aiSuggestion.findMany({
          where: {
            institutionId,
            ...inRange,
            status: 'EDITED',
            suggestedScore: { not: null },
            finalScore: { not: null },
          },
          select: { suggestedScore: true, finalScore: true },
          take: ROW_CAP,
        }),
        this.prisma.quizQuestion.groupBy({
          by: ['status'],
          where: { origin: 'AI', quiz: { institutionId }, ...inRange },
          _count: { _all: true },
        }),
        this.prisma.attendanceSession.findMany({
          where: { institutionId, mode: 'PHOTO', ...inRange },
          select: {
            status: true,
            aiRecognized: true,
            aiUnrecognized: true,
            notConsidered: true,
          },
          take: ROW_CAP + 1,
        }),
      ]);

    const truncated = callRows.length > ROW_CAP || sessions.length > ROW_CAP;

    return {
      from: from ?? null,
      to: to ?? null,
      truncated,
      ...this.callMetrics(callRows.slice(0, ROW_CAP)),
      gradeSuggestions: {
        ...decisions(this.countByStatus(suggestionCounts)),
        avgScoreCorrection: this.scoreCorrection(edited),
      },
      quizQuestions: decisions(this.countByStatus(questionCounts)),
      facialAttendance: this.facial(sessions.slice(0, ROW_CAP)),
    };
  }

  // --- Pieces -------------------------------------------------------------

  private callMetrics(
    rows: {
      kind: AiCallKind;
      success: boolean;
      attempts: number;
      latencyMs: number;
      errorCode: string | null;
      costUsd: Prisma.Decimal | null;
    }[],
  ): Pick<AiMetricsView, 'calls' | 'totals'> {
    const byKind = new Map<AiCallKind, typeof rows>();
    for (const row of rows) {
      byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
    }

    const cost = (items: typeof rows): string | null => {
      const priced = items.flatMap((r) => (r.costUsd ? [r.costUsd] : []));
      if (priced.length === 0) return null;
      return priced
        .reduce(
          (sum, value) => sum.plus(new Decimal(value.toString())),
          new Decimal(0),
        )
        .toFixed(6);
    };

    const calls = [...byKind.entries()]
      .map<AiCallMetrics>(([kind, items]) => {
        const ok = items.filter((r) => r.success);
        const latencies = ok.map((r) => r.latencyMs);
        const errors: Record<string, number> = {};
        for (const row of items) {
          if (!row.success) {
            const code = row.errorCode ?? 'UNKNOWN';
            errors[code] = (errors[code] ?? 0) + 1;
          }
        }
        const avg = mean(latencies);
        return {
          kind,
          total: items.length,
          succeeded: ok.length,
          failed: items.length - ok.length,
          failureRatePct: pct(items.length - ok.length, items.length),
          retried: items.filter((r) => r.attempts > 1).length,
          avgLatencyMs: avg ? Math.round(avg.toNumber()) : null,
          p95LatencyMs: percentile(latencies, 95),
          errors,
          costUsd: cost(items),
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind));

    const failed = rows.filter((r) => !r.success).length;
    return {
      calls,
      totals: {
        calls: rows.length,
        failureRatePct: pct(failed, rows.length),
        costUsd: cost(rows),
      },
    };
  }

  private countByStatus(
    groups: { status: string; _count: { _all: number } }[],
  ): { pending: number; approved: number; edited: number; rejected: number } {
    const count = (status: string): number =>
      groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      pending: count('PENDING_APPROVAL'),
      approved: count('APPROVED'),
      edited: count('EDITED'),
      rejected: count('REJECTED'),
    };
  }

  private scoreCorrection(
    rows: {
      suggestedScore: Prisma.Decimal | null;
      finalScore: Prisma.Decimal | null;
    }[],
  ): string | null {
    const diffs = rows.flatMap((row) =>
      row.suggestedScore && row.finalScore
        ? [
            new Decimal(row.finalScore.toString())
              .minus(new Decimal(row.suggestedScore.toString()))
              .abs()
              .toString(),
          ]
        : [],
    );
    const average = mean(diffs);
    return average ? average.toFixed(2) : null;
  }

  private facial(
    sessions: {
      status: SessionStatus;
      aiRecognized: number | null;
      aiUnrecognized: number | null;
      notConsidered: number | null;
    }[],
  ): AiMetricsView['facialAttendance'] {
    const sum = (pick: (s: (typeof sessions)[number]) => number | null) =>
      sessions.reduce((total, s) => total + (pick(s) ?? 0), 0);

    const recognized = sum((s) => s.aiRecognized);
    const unrecognized = sum((s) => s.aiUnrecognized);
    const notConsidered = sum((s) => s.notConsidered);
    const manualRequired = sessions.filter(
      (s) => s.status === SessionStatus.MANUAL_REQUIRED,
    ).length;
    const searched = recognized + unrecognized;

    return {
      sessions: sessions.length,
      manualRequired,
      fallbackRatePct: pct(manualRequired, sessions.length),
      recognized,
      unrecognized,
      recognitionRatePct: pct(recognized, searched),
      notConsidered,
      coveragePct: pct(searched, searched + notConsidered),
    };
  }

  /** Colombian calendar days → UTC instants; `to` is inclusive, so the bound is the next midnight. */
  private resolveRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const start = from ? this.parseDay(from) : null;
    const end = to ? this.parseDay(to) : null;
    if (start && end && start > end) {
      throw new AppError(
        400,
        'INVALID_RANGE',
        'La fecha inicial no puede ser posterior a la final.',
      );
    }
    if (!start && !end) return undefined;
    return {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: new Date(end.getTime() + DAY_MS) } : {}),
    };
  }

  private parseDay(day: string): Date {
    // A real calendar day survives the UTC round trip (2026-02-31 would not).
    const calendar = new Date(`${day}T00:00:00.000Z`);
    if (
      !DAY.test(day) ||
      Number.isNaN(calendar.getTime()) ||
      calendar.toISOString().slice(0, 10) !== day
    ) {
      throw new AppError(400, 'INVALID_DATE', 'La fecha no es válida.');
    }
    return new Date(`${day}T00:00:00${BOGOTA_OFFSET}`);
  }
}
