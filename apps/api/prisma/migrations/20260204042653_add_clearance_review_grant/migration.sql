-- DropForeignKey
ALTER TABLE "Manifest" DROP CONSTRAINT "Manifest_contentId_fkey";

-- DropIndex
DROP INDEX "ContentItem_storefrontStatus_idx";

-- AlterTable
ALTER TABLE "ClearanceRequest" ADD COLUMN     "reviewGrantedAt" TIMESTAMP(3),
ADD COLUMN     "reviewGrantedByUserId" TEXT;

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
