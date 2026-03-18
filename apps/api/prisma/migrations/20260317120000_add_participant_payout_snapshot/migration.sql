-- Phase 1 participant-level payout snapshot for delegated provider commerce.
CREATE TABLE "ProviderPaymentParticipantAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerPaymentIntentId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "contentId" TEXT,
  "creatorNodeId" TEXT NOT NULL,
  "participantRef" TEXT NOT NULL,
  "participantId" TEXT,
  "splitParticipantId" TEXT,
  "participantUserId" TEXT,
  "participantEmail" TEXT,
  "role" TEXT,
  "roleKey" TEXT NOT NULL DEFAULT '',
  "bps" INTEGER NOT NULL,
  "amountSats" BIGINT NOT NULL,
  "allocationSource" TEXT NOT NULL,
  "allocationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ParticipantPayout" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "allocationId" TEXT NOT NULL,
  "providerPaymentIntentId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "amountSats" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "payoutRail" TEXT,
  "destinationType" TEXT,
  "destinationSummary" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "attemptId" TEXT,
  "lockedAt" DATETIME,
  "lastCheckedAt" DATETIME,
  "payoutReference" TEXT,
  "lastError" TEXT,
  "remittedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ParticipantPayout_allocationId_fkey"
    FOREIGN KEY ("allocationId") REFERENCES "ProviderPaymentParticipantAllocation" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderPaymentParticipantAllocation_providerPaymentIntentId_participantRef_roleKey_key"
ON "ProviderPaymentParticipantAllocation"("providerPaymentIntentId", "participantRef", "roleKey");
CREATE INDEX "ProviderPaymentParticipantAllocation_providerPaymentIntentId_idx"
ON "ProviderPaymentParticipantAllocation"("providerPaymentIntentId");
CREATE INDEX "ProviderPaymentParticipantAllocation_paymentIntentId_idx"
ON "ProviderPaymentParticipantAllocation"("paymentIntentId");

CREATE UNIQUE INDEX "ParticipantPayout_allocationId_key"
ON "ParticipantPayout"("allocationId");
CREATE INDEX "ParticipantPayout_providerPaymentIntentId_idx"
ON "ParticipantPayout"("providerPaymentIntentId");
CREATE INDEX "ParticipantPayout_paymentIntentId_idx"
ON "ParticipantPayout"("paymentIntentId");
CREATE INDEX "ParticipantPayout_status_idx"
ON "ParticipantPayout"("status");
