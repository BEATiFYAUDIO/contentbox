-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "PaymentIntent_ipHash_idx" ON "PaymentIntent"("ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_buyerId_contentId_key" ON "Entitlement"("buyerId", "contentId");
