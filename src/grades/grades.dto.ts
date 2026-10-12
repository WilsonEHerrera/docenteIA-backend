import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

// Shape only; the 0–5 and 0–100 ranges are rules of src/domain.
const GRADE = /^\d(\.\d{1,2})?$/;
const WEIGHT = /^\d{1,3}(\.\d{1,2})?$/;

export class CreateActivityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Decimal string, e.g. "30" or "33.33". */
  @Matches(WEIGHT)
  weightPct!: string;

  /** Defaults to the course period. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  period?: string;
}

export class UpdateActivityDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(WEIGHT)
  weightPct?: string;
}

export class UpdateGradeDto {
  /** Decimal string between "0" and "5", or null to clear the grade. */
  @ValidateIf((_dto, value: unknown) => value !== null)
  @Matches(GRADE)
  value!: string | null;
}

export class GradebookQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string;
}

export interface ActivityView {
  id: string;
  courseId: string;
  name: string;
  weightPct: string;
  period: string;
}

export interface GradeView {
  id: string;
  activityId: string;
  studentId: string;
  value: string | null;
}

export interface GradebookRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  /** activityId → grade ("4.05") or null while ungraded. */
  grades: Record<string, string | null>;
  /** activityId → grade id, to use with PUT /grades/:id. */
  gradeIds: Record<string, string>;
  /** Weighted average of the graded activities; null if none is graded. */
  average: string | null;
  /** true when every activity of a complete (100 %) period is graded. */
  isFinal: boolean;
  /** Sum of the weights already graded (0–100). */
  gradedWeightPct: string;
  /** Unexcused absences in confirmed attendance sessions. */
  absences: number;
  /** true once absences reach the alert threshold (default 80 % of maxAbsences). */
  absenceAlert: boolean;
  /** Low average OR absence alert. */
  atRisk: boolean;
}

export interface GradebookView {
  period: string;
  weightsTotal: string;
  weightsComplete: boolean;
  activities: ActivityView[];
  rows: GradebookRow[];
}
