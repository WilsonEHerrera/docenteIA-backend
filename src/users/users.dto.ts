import { Role } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsEnum(Role)
  role!: Role;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Clears the failed-attempts counter and any temporary lock. */
  @IsOptional()
  @IsBoolean()
  unlock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}
