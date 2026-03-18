-- Phase 2 participant payout execution fields.
ALTER TABLE "ParticipantPayout" ADD COLUMN "readinessReason" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationResolvedAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationSource" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationFingerprint" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "blockedReason" TEXT;

CREATE INDEX "ParticipantPayout_nextRetryAt_idx"
ON "ParticipantPayout"("nextRetryAt");
