-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('FACIAL_ATTENDANCE');

-- AlterEnum
ALTER TYPE "AiCallKind" ADD VALUE 'FACE_ENROLLMENT';

-- CreateTable
CREATE TABLE "student_guardians" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_consents" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "grantedById" UUID NOT NULL,
    "grantedByRole" "Role" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,

    CONSTRAINT "biometric_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_references" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "consentId" UUID NOT NULL,
    "embeddingEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "face_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_guardians_guardianId_idx" ON "student_guardians"("guardianId");

-- CreateIndex
CREATE INDEX "student_guardians_institutionId_idx" ON "student_guardians"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_studentId_guardianId_key" ON "student_guardians"("studentId", "guardianId");

-- CreateIndex
CREATE INDEX "biometric_consents_studentId_purpose_idx" ON "biometric_consents"("studentId", "purpose");

-- CreateIndex
CREATE INDEX "biometric_consents_institutionId_idx" ON "biometric_consents"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "face_references_studentId_key" ON "face_references"("studentId");

-- CreateIndex
CREATE INDEX "face_references_institutionId_idx" ON "face_references"("institutionId");

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_references" ADD CONSTRAINT "face_references_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_references" ADD CONSTRAINT "face_references_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

