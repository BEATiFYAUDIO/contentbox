-- Payout execution hardening: participant destination verification metadata + payout key idempotency.
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "lastCheckedAt" DATETIME;
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "verificationMethod" TEXT;

ALTER TABLE "ParticipantPayout" ADD COLUMN "payoutKey" TEXT;

CREATE UNIQUE INDEX "ParticipantPayout_payoutKey_key"
ON "ParticipantPayout"("payoutKey");
