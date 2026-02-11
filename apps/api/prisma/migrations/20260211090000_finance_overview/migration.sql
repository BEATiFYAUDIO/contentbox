CREATE TYPE "SaleStatus" AS ENUM ('pending', 'paid', 'failed', 'expired');
CREATE TYPE "PaymentRecordStatus" AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE "RoyaltyStatus" AS ENUM ('pending', 'earned', 'paid');
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'completed');
CREATE TYPE "TransactionKind" AS ENUM ('sale', 'payment', 'royalty', 'payout');

CREATE TABLE IF NOT EXISTS "Sale" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "buyerUserId" TEXT,
  "paymentIntentId" TEXT,
  "amountSats" BIGINT NOT NULL,
  "status" "SaleStatus" NOT NULL DEFAULT 'pending',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentRecord" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "rail" "PaymentRail",
  "providerId" TEXT,
  "amountSats" BIGINT NOT NULL,
  "status" "PaymentRecordStatus" NOT NULL DEFAULT 'pending',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Royalty" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "settlementId" TEXT,
  "settlementLineId" TEXT,
  "contentId" TEXT NOT NULL,
  "participantId" TEXT,
  "participantEmail" TEXT,
  "role" TEXT,
  "amountSats" BIGINT NOT NULL,
  "status" "RoyaltyStatus" NOT NULL DEFAULT 'pending',
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "payoutId" TEXT,
  CONSTRAINT "Royalty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payout" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "participantEmail" TEXT,
  "method" "PayoutMethodCode",
  "amountSats" BIGINT NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
  "settlementRecords" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransactionHistory" (
  "id" TEXT NOT NULL,
  "kind" "TransactionKind" NOT NULL,
  "refId" TEXT NOT NULL,
  "contentId" TEXT,
  "amountSats" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "TransactionHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Sale_paymentIntentId_key" ON "Sale"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "Sale_contentId_idx" ON "Sale"("contentId");
CREATE INDEX IF NOT EXISTS "Sale_buyerUserId_idx" ON "Sale"("buyerUserId");
CREATE INDEX IF NOT EXISTS "Sale_status_idx" ON "Sale"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRecord_paymentIntentId_key" ON "PaymentRecord"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "PaymentRecord_saleId_idx" ON "PaymentRecord"("saleId");
CREATE INDEX IF NOT EXISTS "PaymentRecord_status_idx" ON "PaymentRecord"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "Royalty_settlementLineId_key" ON "Royalty"("settlementLineId");
CREATE INDEX IF NOT EXISTS "Royalty_saleId_idx" ON "Royalty"("saleId");
CREATE INDEX IF NOT EXISTS "Royalty_contentId_idx" ON "Royalty"("contentId");
CREATE INDEX IF NOT EXISTS "Royalty_participantId_idx" ON "Royalty"("participantId");
CREATE INDEX IF NOT EXISTS "Royalty_participantEmail_idx" ON "Royalty"("participantEmail");
CREATE INDEX IF NOT EXISTS "Royalty_status_idx" ON "Royalty"("status");

CREATE INDEX IF NOT EXISTS "Payout_userId_idx" ON "Payout"("userId");
CREATE INDEX IF NOT EXISTS "Payout_participantEmail_idx" ON "Payout"("participantEmail");
CREATE INDEX IF NOT EXISTS "Payout_status_idx" ON "Payout"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "TransactionHistory_kind_refId_key" ON "TransactionHistory"("kind", "refId");
CREATE INDEX IF NOT EXISTS "TransactionHistory_contentId_idx" ON "TransactionHistory"("contentId");
CREATE INDEX IF NOT EXISTS "TransactionHistory_createdAt_idx" ON "TransactionHistory"("createdAt");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Royalty" ADD CONSTRAINT "Royalty_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Royalty" ADD CONSTRAINT "Royalty_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Royalty" ADD CONSTRAINT "Royalty_settlementLineId_fkey" FOREIGN KEY ("settlementLineId") REFERENCES "SettlementLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Royalty" ADD CONSTRAINT "Royalty_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Royalty" ADD CONSTRAINT "Royalty_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
