-- Preserve creator signing-key history while keeping WitnessIdentity as the
-- stable per-user container. WitnessIdentity.publicKey/fingerprint remain
-- compatibility mirrors of the active key during this migration.
CREATE TABLE "WitnessIdentityKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "witnessIdentityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "retiredAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "WitnessIdentityKey_witnessIdentityId_fkey" FOREIGN KEY ("witnessIdentityId") REFERENCES "WitnessIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WitnessIdentityKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WitnessIdentityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "witnessIdentityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "previousKeyId" TEXT,
    "newKeyId" TEXT,
    "authorization" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WitnessIdentityEvent_witnessIdentityId_fkey" FOREIGN KEY ("witnessIdentityId") REFERENCES "WitnessIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WitnessIdentityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WitnessIdentityRecoveryChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "witnessIdentityId" TEXT NOT NULL,
    "candidatePublicKey" TEXT NOT NULL,
    "candidateFingerprint" TEXT NOT NULL,
    "challengeText" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WitnessIdentityRecoveryChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WitnessIdentityRecoveryChallenge_witnessIdentityId_fkey" FOREIGN KEY ("witnessIdentityId") REFERENCES "WitnessIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WitnessIdentityKey_witnessIdentityId_status_idx" ON "WitnessIdentityKey"("witnessIdentityId", "status");
CREATE INDEX "WitnessIdentityKey_userId_status_idx" ON "WitnessIdentityKey"("userId", "status");
CREATE INDEX "WitnessIdentityKey_fingerprint_idx" ON "WitnessIdentityKey"("fingerprint");
CREATE INDEX "WitnessIdentityKey_publicKey_idx" ON "WitnessIdentityKey"("publicKey");
CREATE INDEX "WitnessIdentityEvent_witnessIdentityId_createdAt_idx" ON "WitnessIdentityEvent"("witnessIdentityId", "createdAt");
CREATE INDEX "WitnessIdentityEvent_userId_createdAt_idx" ON "WitnessIdentityEvent"("userId", "createdAt");
CREATE INDEX "WitnessIdentityRecoveryChallenge_userId_expiresAt_idx" ON "WitnessIdentityRecoveryChallenge"("userId", "expiresAt");
CREATE INDEX "WitnessIdentityRecoveryChallenge_witnessIdentityId_usedAt_idx" ON "WitnessIdentityRecoveryChallenge"("witnessIdentityId", "usedAt");

INSERT INTO "WitnessIdentityKey" (
    "id",
    "witnessIdentityId",
    "userId",
    "algorithm",
    "publicKey",
    "fingerprint",
    "status",
    "statusReason",
    "createdAt",
    "activatedAt",
    "revokedAt"
)
SELECT
    'wik_' || lower(hex(randomblob(16))),
    "id",
    "userId",
    "algorithm",
    "publicKey",
    "fingerprint",
    CASE WHEN "revokedAt" IS NULL THEN 'active' ELSE 'revoked' END,
    'initial',
    "createdAt",
    "createdAt",
    "revokedAt"
FROM "WitnessIdentity";

INSERT INTO "WitnessIdentityEvent" (
    "id",
    "witnessIdentityId",
    "userId",
    "type",
    "newKeyId",
    "authorization",
    "reason",
    "createdAt"
)
SELECT
    'wie_' || lower(hex(randomblob(16))),
    k."witnessIdentityId",
    k."userId",
    'initial',
    k."id",
    'migration',
    'backfilled from legacy WitnessIdentity row',
    k."createdAt"
FROM "WitnessIdentityKey" k
WHERE k."statusReason" = 'initial';
