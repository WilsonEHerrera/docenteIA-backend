import { SuggestionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

// Shape only; ranges and the "sums to 100" rule live in src/domain.
const GRADE = /^\d(\.\d{1,2})?$/;
const WEIGHT = /^\d{1,3}(\.\d{1,2})?$/;

export class RubricLevelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Decimal string between "0" and "5". */
  @Matches(GRADE)
  score!: string;
}

export class RubricCriterionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Share of the final score; all criteria must sum to 100. */
  @Matches(WEIGHT)
  weightPct!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => RubricLevelDto)
  levels!: RubricLevelDto[];
}

export class UpsertRubricDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  criteria!: RubricCriterionDto[];
}

export class SubmissionItemDto {
  @IsUUID()
  studentId!: string;

  /** Text already extracted from the student's work. */
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text!: string;
}

export class CreateSubmissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SubmissionItemDto)
  items!: SubmissionItemDto[];
}

export class EditSuggestionDto {
  /** Decimal string between "0" and "5". */
  @Matches(GRADE)
  finalScore!: string;

  @IsString()
  @MaxLength(4000)
  feedback!: string;
}

export class SuggestionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;
}

export interface RubricView {
  id: string;
  activityId: string;
  criteria: {
    id: string;
    name: string;
    weightPct: string;
    levels: { name: string; score: string }[];
  }[];
}

export interface CriterionResultView {
  criterionId: string;
  criterionName: string;
  weightPct: string;
  level: string;
  score: string;
  justification: string;
  evidenceQuote: string;
}

export interface AiSuggestionView {
  id: string;
  type: 'GRADE';
  status: SuggestionStatus;
  suggestedScore: string | null;
  finalScore: string | null;
  criteria: CriterionResultView[];
  feedback: string;
  modelVersion: string;
  promptVersion: string;
  createdAt: string;
}

export interface SuggestionListItem extends AiSuggestionView {
  submissionId: string;
  studentId: string;
  studentCode: string;
  studentName: string;
}

export interface SubmissionView {
  id: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  status: 'PROCESSING' | 'SUGGESTED' | 'MANUAL_REQUIRED';
  updatedAt: string;
  suggestionId: string | null;
  suggestionStatus: SuggestionStatus | null;
}

export interface SubmissionDetailView {
  submission: {
    id: string;
    studentId: string;
    studentCode: string;
    studentName: string;
    status: SubmissionView['status'];
    text: string;
  };
  suggestion: AiSuggestionView | null;
}

export interface CreateSubmissionsResult {
  accepted: number;
  rejected: { studentId: string; reason: string }[];
}
