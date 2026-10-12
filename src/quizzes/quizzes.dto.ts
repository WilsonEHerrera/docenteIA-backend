import { QuestionType, QuizStatus, SuggestionStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class GenerateQuizDto {
  @IsUUID()
  courseId!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  /** At least one of `topic` / `sourceText` is required. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  topic?: string;

  /** Material (already extracted text) to generate the questions from. */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  sourceText?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;
}

export class UpdateQuizDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  prompt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  correctIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;

  /** Teacher decision. Editing the content marks the question EDITED by itself. */
  @IsOptional()
  @IsIn(['APPROVED', 'REJECTED'])
  status?: 'APPROVED' | 'REJECTED';
}

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  prompt!: string;

  /** Omit for TRUE_FALSE (fixed) and OPEN (none). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  correctIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;
}

export interface QuestionView {
  id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctIndex: number | null;
  explanation: string;
  status: SuggestionStatus;
}

export interface QuizView {
  id: string;
  courseId: string;
  title: string;
  topic: string | null;
  /** `GENERATING` means the questions are not there yet: poll again. */
  status: QuizStatus;
  provider: string | null;
  promptVersion: string | null;
  createdAt: string;
  publishedAt: string | null;
  questions: QuestionView[];
}

export interface QuizSummaryView {
  id: string;
  title: string;
  status: QuizStatus;
  questionCount: number;
  approvedCount: number;
  pendingCount: number;
  createdAt: string;
  publishedAt: string | null;
}
