import { IsOptional, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class AiMetricsQueryDto {
  /** "YYYY-MM-DD" (Colombia), inclusive. Omit for all time. */
  @IsOptional()
  @Matches(DAY)
  from?: string;

  /** "YYYY-MM-DD" (Colombia), inclusive. */
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export interface AiCallMetrics {
  kind:
    | 'FACE_ENROLLMENT'
    | 'FACE_RECOGNITION'
    | 'TEXT_EVALUATION'
    | 'QUIZ_GENERATION';
  total: number;
  succeeded: number;
  failed: number;
  failureRatePct: string | null;
  /** Calls that needed more than one attempt. */
  retried: number;
  /** Latency of successful calls, including their retries. */
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** TIMEOUT | PROVIDER_ERROR | INVALID_OUTPUT → how many. */
  errors: Record<string, number>;
  /** null while the provider reports no cost (always so with the fake adapters). */
  costUsd: string | null;
}

export interface DecisionMetrics {
  total: number;
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
  /** approved / decided — the AI was right as it came. */
  acceptedRatePct: string | null;
  /** (edited + rejected) / decided — the teacher had to correct it. */
  correctedRatePct: string | null;
}

export interface AiMetricsView {
  from: string | null;
  to: string | null;
  /** The call log was cut at the safety cap; narrow the date range. */
  truncated: boolean;
  calls: AiCallMetrics[];
  totals: {
    calls: number;
    failureRatePct: string | null;
    costUsd: string | null;
  };
  /** Rubric grading suggestions. Re-uploaded (superseded) ones are not counted as rejections. */
  gradeSuggestions: DecisionMetrics & {
    /** Mean |finalScore − suggestedScore| on edited suggestions. */
    avgScoreCorrection: string | null;
  };
  /** AI-written quiz questions only (questions the teacher wrote are excluded). */
  quizQuestions: DecisionMetrics;
  facialAttendance: {
    sessions: number;
    manualRequired: number;
    /** manualRequired / sessions: how often the AI path was not usable. */
    fallbackRatePct: string | null;
    /** Students the AI searched for and found / searched for. Before any correction. */
    recognized: number;
    unrecognized: number;
    recognitionRatePct: string | null;
    /** Students nobody looked for (no consent or no reference). */
    notConsidered: number;
    /** searched / (searched + notConsidered): how much of the class the AI could cover. */
    coveragePct: string | null;
  };
}
