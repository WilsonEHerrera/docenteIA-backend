-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "facesNotMatched" INTEGER;

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "confidence" DECIMAL(4,3);

