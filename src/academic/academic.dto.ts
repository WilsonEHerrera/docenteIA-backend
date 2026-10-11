import { Weekday } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const CODE = /^[A-Za-z0-9_-]{1,32}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateSubjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Matches(CODE)
  code!: string;
}

export class CreateCourseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  period!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  teacherId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxAbsences?: number;
}

export class CreateStudentDto {
  @Matches(CODE)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class CreateScheduleDto {
  @IsEnum(Weekday)
  weekday!: Weekday;

  @Matches(TIME)
  startTime!: string;

  @Matches(TIME)
  endTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  room?: string;
}

export class EnrollStudentDto {
  @Matches(CODE)
  studentCode!: string;
}

export interface CourseView {
  id: string;
  name: string;
  period: string;
  maxAbsences: number;
  subject: { id: string; name: string; code: string };
  teacher: { id: string; fullName: string };
  enrolledCount: number;
}

export interface CourseDetailView extends CourseView {
  schedules: {
    id: string;
    weekday: Weekday;
    startTime: string;
    endTime: string;
    room: string | null;
  }[];
  students: { id: string; code: string; fullName: string }[];
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  enrolled: number;
  alreadyEnrolled: number;
  studentsCreated: number;
  errors: ImportRowError[];
}
