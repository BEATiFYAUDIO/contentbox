-- AlterEnum
ALTER TYPE "PaymentIntentStatus" ADD VALUE 'self_claimed';

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "buyerId" TEXT;

-- CreateIndex
CREATE INDEX "Entitlement_buyerId_idx" ON "Entitlement"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_buyerId_contentId_manifestSha256_key" ON "Entitlement"("buyerId", "contentId", "manifestSha256");

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
