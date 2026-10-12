-- CreateEnum
CREATE TYPE "QuestionOrigin" AS ENUM ('AI', 'TEACHER');

-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('MANUAL', 'PHOTO');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('GENERATING', 'DRAFT', 'MANUAL_REQUIRED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'OPEN');

-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "aiRecognized" INTEGER,
ADD COLUMN     "aiUnrecognized" INTEGER,
ADD COLUMN     "mode" "AttendanceMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "notConsidered" INTEGER;

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "sourceText" TEXT,
    "requestedCount" INTEGER NOT NULL DEFAULT 5,
    "status" "QuizStatus" NOT NULL DEFAULT 'GENERATING',
    "provider" TEXT,
    "promptVersion" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER,
    "explanation" TEXT NOT NULL,
    "origin" "QuestionOrigin" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quizzes_courseId_idx" ON "quizzes"("courseId");

-- CreateIndex
CREATE INDEX "quizzes_institutionId_idx" ON "quizzes"("institutionId");

-- CreateIndex
CREATE INDEX "quizzes_status_idx" ON "quizzes"("status");

-- CreateIndex
CREATE INDEX "quiz_questions_quizId_idx" ON "quiz_questions"("quizId");

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

