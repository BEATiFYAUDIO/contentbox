-- AlterTable
ALTER TABLE "RemoteInvite" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAT',
    "rail" TEXT NOT NULL,
    "memo" TEXT,
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sale_intentId_key" ON "Sale"("intentId");

-- CreateIndex
CREATE INDEX "Sale_sellerUserId_recognizedAt_idx" ON "Sale"("sellerUserId", "recognizedAt");

-- CreateIndex
CREATE INDEX "Sale_contentId_idx" ON "Sale"("contentId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
