-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerSession" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_email_key" ON "Buyer"("email");

-- CreateIndex
CREATE INDEX "Buyer_email_idx" ON "Buyer"("email");

-- CreateIndex
CREATE INDEX "BuyerOtp_email_createdAt_idx" ON "BuyerOtp"("email", "createdAt");

-- CreateIndex
CREATE INDEX "BuyerOtp_expiresAt_idx" ON "BuyerOtp"("expiresAt");

-- CreateIndex
CREATE INDEX "BuyerSession_buyerId_idx" ON "BuyerSession"("buyerId");

-- CreateIndex
CREATE INDEX "BuyerSession_expiresAt_idx" ON "BuyerSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "BuyerSession" ADD CONSTRAINT "BuyerSession_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
