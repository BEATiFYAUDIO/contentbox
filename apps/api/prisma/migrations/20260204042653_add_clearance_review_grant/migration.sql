-- DropForeignKey
ALTER TABLE "Manifest" DROP CONSTRAINT "Manifest_contentId_fkey";

-- DropIndex
DROP INDEX "ContentItem_storefrontStatus_idx";

-- AlterTable
ALTER TABLE IF EXISTS "ClearanceRequest"
ADD COLUMN IF NOT EXISTS "reviewGrantedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewGrantedByUserId" TEXT;

-- AlterTable
ALTER TABLE "ContentCredit" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ContentItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DerivativeAuthorization" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentIntent" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "purpose" DROP DEFAULT,
ALTER COLUMN "subjectType" DROP DEFAULT,
ALTER COLUMN "subjectId" DROP DEFAULT;
