import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class PerformanceQueryDto {
  @IsUUID()
  courseId!: string;

  /** Defaults to the course period. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string;
}

export class AttendanceReportQueryDto {
  @IsUUID()
  courseId!: string;

  /** "YYYY-MM-DD", inclusive. */
  @IsOptional()
  @Matches(DAY)
  from?: string;

  /** "YYYY-MM-DD", inclusive. */
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export class ExportQueryDto {
  @IsIn(['performance', 'attendance'])
  type!: 'performance' | 'attendance';

  /** Only CSV is supported. */
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';

  @IsUUID()
  courseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string;

  @IsOptional()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export interface PerformanceReport {
  course: { id: string; name: string };
  period: string;
  weightsTotal: string;
  weightsComplete: boolean;
  studentCount: number;
  /** Students with at least one graded activity. */
  gradedStudents: number;
  /** Mean of the students' averages; null when nobody has grades. */
  courseAverage: string | null;
  belowPassing: number;
  absenceAlerts: number;
  atRiskCount: number;
  activities: {
    id: string;
    name: string;
    weightPct: string;
    gradedCount: number;
    average: string | null;
  }[];
  atRiskStudents: {
    studentId: string;
    studentCode: string;
    studentName: string;
    average: string | null;
    absences: number;
    absenceAlert: boolean;
  }[];
}

export interface AttendanceReportRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  present: number;
  absent: number;
  excused: number;
  /** present / (present + absent) as a percentage; excused sessions are left out. */
  attendancePct: string | null;
}

export interface AttendanceReport {
  course: { id: string; name: string };
  from: string | null;
  to: string | null;
  confirmedSessions: number;
  overallAttendancePct: string | null;
  rows: AttendanceReportRow[];
}
