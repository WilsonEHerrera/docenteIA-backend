-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PROCESSING', 'SUGGESTED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EDITED', 'REJECTED');

-- CreateTable
CREATE TABLE "rubrics" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_criteria" (
    "id" UUID NOT NULL,
    "rubricId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weightPct" DECIMAL(5,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "levels" JSONB NOT NULL,

    CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "suggestedScore" DECIMAL(3,2),
    "finalScore" DECIMAL(3,2),
    "feedback" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rubrics_activityId_key" ON "rubrics"("activityId");

-- CreateIndex
CREATE INDEX "rubrics_institutionId_idx" ON "rubrics"("institutionId");

-- CreateIndex
CREATE INDEX "rubric_criteria_rubricId_idx" ON "rubric_criteria"("rubricId");

-- CreateIndex
CREATE INDEX "submissions_institutionId_idx" ON "submissions"("institutionId");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_activityId_studentId_key" ON "submissions"("activityId", "studentId");

-- CreateIndex
CREATE INDEX "ai_suggestions_submissionId_idx" ON "ai_suggestions"("submissionId");

-- CreateIndex
CREATE INDEX "ai_suggestions_institutionId_status_idx" ON "ai_suggestions"("institutionId", "status");

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

