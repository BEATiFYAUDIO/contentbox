ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "receiptToken" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "receiptTokenExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "PaymentIntent_receiptToken_idx" ON "PaymentIntent"("receiptToken");
