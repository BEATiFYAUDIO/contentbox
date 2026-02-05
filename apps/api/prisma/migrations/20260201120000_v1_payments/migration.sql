-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('lnd', 'btcpay', 'none');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('unpaid', 'paid', 'expired');

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "splitVersion" INTEGER NOT NULL,
    "rateSatsPerUnit" INTEGER NOT NULL,
    "unitsPurchased" INTEGER NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'unpaid',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReceiptRef" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptPath" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditReceiptRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditSpend" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,

    CONSTRAINT "CreditSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditPurchase_userId_idx" ON "CreditPurchase"("userId");

-- CreateIndex
CREATE INDEX "CreditPurchase_proofHash_idx" ON "CreditPurchase"("proofHash");

-- CreateIndex
CREATE INDEX "CreditPurchase_contentId_idx" ON "CreditPurchase"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReceiptRef_purchaseId_key" ON "CreditReceiptRef"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReceiptRef_receiptId_key" ON "CreditReceiptRef"("receiptId");

-- CreateIndex
CREATE INDEX "CreditReceiptRef_purchaseId_idx" ON "CreditReceiptRef"("purchaseId");

-- CreateIndex
CREATE INDEX "CreditReceiptRef_receiptId_idx" ON "CreditReceiptRef"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditSpend_receiptId_unitIndex_key" ON "CreditSpend"("receiptId", "unitIndex");

-- CreateIndex
CREATE INDEX "CreditSpend_receiptId_idx" ON "CreditSpend"("receiptId");

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReceiptRef" ADD CONSTRAINT "CreditReceiptRef_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CreditPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
