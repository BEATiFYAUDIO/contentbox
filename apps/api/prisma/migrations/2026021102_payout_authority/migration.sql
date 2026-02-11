-- Add idempotency key to payouts
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- Payout authority tokens (collaborator withdrawals)
CREATE TABLE IF NOT EXISTS "PayoutAuthority" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "splitVersionId" TEXT NOT NULL,
  "splitParticipantId" TEXT NOT NULL,
  "sellerUserId" TEXT NOT NULL,
  "collaboratorUserId" TEXT,
  "participantEmail" TEXT,
  "minWithdrawSats" BIGINT NOT NULL DEFAULT 1,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),

  CONSTRAINT "PayoutAuthority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayoutAuthority_tokenHash_key" ON "PayoutAuthority"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutAuthority_splitVersionId_splitParticipantId_key" ON "PayoutAuthority"("splitVersionId","splitParticipantId");

CREATE INDEX IF NOT EXISTS "PayoutAuthority_splitVersionId_idx" ON "PayoutAuthority"("splitVersionId");
CREATE INDEX IF NOT EXISTS "PayoutAuthority_splitParticipantId_idx" ON "PayoutAuthority"("splitParticipantId");
CREATE INDEX IF NOT EXISTS "PayoutAuthority_sellerUserId_idx" ON "PayoutAuthority"("sellerUserId");

ALTER TABLE "PayoutAuthority" ADD CONSTRAINT "PayoutAuthority_splitVersionId_fkey"
  FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayoutAuthority" ADD CONSTRAINT "PayoutAuthority_splitParticipantId_fkey"
  FOREIGN KEY ("splitParticipantId") REFERENCES "SplitParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayoutAuthority" ADD CONSTRAINT "PayoutAuthority_sellerUserId_fkey"
  FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
