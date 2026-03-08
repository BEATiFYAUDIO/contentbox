-- DropForeignKey
ALTER TABLE "Manifest" DROP CONSTRAINT "Manifest_contentId_fkey";

-- DropIndex
DROP INDEX "ContentItem_storefrontStatus_idx";

-- AlterTable
ALTER TABLE IF EXISTS "ClearanceRequest"
ADD COLUMN IF NOT EXISTS "reviewGrantedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewGrantedByUserId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContentCredit" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCredit_pkey" PRIMARY KEY ("id")
);

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
