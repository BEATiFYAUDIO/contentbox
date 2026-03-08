-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('CONTENT_PURCHASE', 'STREAM_SESSION', 'TIP');

-- CreateEnum
CREATE TYPE "PaymentSubjectType" AS ENUM ('CONTENT', 'STREAM_SESSION');

-- AlterTable PaymentIntent
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "purpose" "PaymentPurpose" NOT NULL DEFAULT 'CONTENT_PURCHASE';
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "subjectType" "PaymentSubjectType" NOT NULL DEFAULT 'CONTENT';
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "subjectId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "memo" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "lightningExpiresAt" TIMESTAMP(3);
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "onchainDerivationIndex" INTEGER;
ALTER TABLE "PaymentIntent" ALTER COLUMN "manifestSha256" DROP NOT NULL;
ALTER TABLE "PaymentIntent" ALTER COLUMN "paidVia" DROP NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS "PaymentIntent_status_idx" ON "PaymentIntent"("status");
CREATE INDEX IF NOT EXISTS "PaymentIntent_purpose_subjectType_subjectId_idx" ON "PaymentIntent"("purpose", "subjectType", "subjectId");
