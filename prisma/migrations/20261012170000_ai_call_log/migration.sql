-- CreateEnum
CREATE TYPE "AiCallKind" AS ENUM ('FACE_RECOGNITION', 'TEXT_EVALUATION', 'QUIZ_GENERATION');

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "userId" UUID,
    "kind" "AiCallKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT,
    "success" BOOLEAN NOT NULL,
    "attempts" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_logs_institutionId_createdAt_idx" ON "ai_call_logs"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_logs_kind_createdAt_idx" ON "ai_call_logs"("kind", "createdAt");

