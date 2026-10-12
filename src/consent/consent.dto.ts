import { ConsentPurpose, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class GrantConsentDto {
  @IsEnum(ConsentPurpose)
  purpose!: ConsentPurpose;

  /** Must be true: a refusal is simply the absence of consent. */
  @IsBoolean()
  accepted!: boolean;
}

export class RevokeConsentQueryDto {
  @IsOptional()
  @IsEnum(ConsentPurpose)
  purpose?: ConsentPurpose;
}

export class LinkGuardianDto {
  @IsUUID()
  userId!: string;
}

export interface ConsentView {
  id: string;
  purpose: ConsentPurpose;
  grantedAt: string;
  grantedByRole: Role;
  revokedAt: string | null;
}

export interface StudentConsentStatus {
  studentId: string;
  studentCode: string;
  studentName: string;
  purpose: ConsentPurpose;
  /** A consent is in force (granted and not revoked). */
  active: boolean;
  hasFaceReference: boolean;
  consents: ConsentView[];
}

export interface CourseConsentRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  hasConsent: boolean;
  hasFaceReference: boolean;
  /** Will be considered by facial attendance; everyone else is marked by hand. */
  eligible: boolean;
}

export interface GuardianView {
  userId: string;
  fullName: string;
  email: string;
}

export interface GuardianStudentView {
  studentId: string;
  studentCode: string;
  studentName: string;
  consentActive: boolean;
  hasFaceReference: boolean;
}

export interface FaceReferenceView {
  studentId: string;
  registeredAt: string;
}
