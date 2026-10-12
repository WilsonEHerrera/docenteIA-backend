import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { MANUAL_STATUSES } from '../domain/attendance-rules';

export class ManualRecordDto {
  @IsUUID()
  studentId!: string;

  @IsIn(MANUAL_STATUSES)
  status!: AttendanceStatus;
}

export class CreateManualSessionDto {
  @IsUUID()
  courseId!: string;

  /** "YYYY-MM-DD"; defaults to today (America/Bogota). Future dates are rejected. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  /** Must contain every enrolled student exactly once. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ManualRecordDto)
  records!: ManualRecordDto[];
}

export class PhotoSessionQueryDto {
  @IsUUID()
  courseId!: string;

  /** "YYYY-MM-DD"; defaults to today (America/Bogota). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class UpdateRecordDto {
  @IsIn(MANUAL_STATUSES)
  status!: AttendanceStatus;
}

export interface AttendanceStats {
  present: number;
  absent: number;
  excused: number;
  unrecognized: number;
}

export interface AttendanceRecordView {
  id: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  status: AttendanceStatus;
  source: 'AI' | 'MANUAL';
  confidence: number | null;
}

export interface AttendanceSessionView {
  id: string;
  courseId: string;
  /** "YYYY-MM-DD" */
  date: string;
  status: 'PROCESSING' | 'READY' | 'MANUAL_REQUIRED' | 'CONFIRMED';
  confirmedAt: string | null;
  /** Faces detected that matched nobody (facial sessions); null otherwise. */
  facesNotMatched: number | null;
  records: AttendanceRecordView[];
  stats: AttendanceStats;
}

export interface AttendanceSessionSummaryView {
  id: string;
  date: string;
  status: AttendanceSessionView['status'];
  confirmedAt: string | null;
  stats: AttendanceStats;
}

export interface AttendanceSummaryRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  /** Unexcused absences in confirmed sessions. */
  absences: number;
  excused: number;
  maxAbsences: number;
  /** % of the allowed absences already used (may exceed 100). */
  usagePct: number;
  /** true once usagePct reaches the alert threshold. */
  alert: boolean;
}

export interface AttendanceSummaryView {
  maxAbsences: number;
  alertThresholdPct: number;
  confirmedSessions: number;
  rows: AttendanceSummaryRow[];
}
