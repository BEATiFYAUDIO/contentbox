-- AlterTable
ALTER TABLE "ParticipantPayout" ADD COLUMN "blockedReason" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationFingerprint" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationResolvedAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "destinationSource" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "ParticipantPayout" ADD COLUMN "payoutKey" TEXT;
ALTER TABLE "ParticipantPayout" ADD COLUMN "readinessReason" TEXT;

-- AlterTable
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "lastCheckedAt" DATETIME;
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "verificationMethod" TEXT;
ALTER TABLE "ParticipantPayoutDestination" ADD COLUMN "verifiedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "previousVersionContentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "featureOnProfile" BOOLEAN NOT NULL DEFAULT false,
    "storefrontStatus" TEXT NOT NULL DEFAULT 'DISABLED',
    "priceSats" BIGINT,
    "deliveryMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "manifestId" TEXT,
    "currentSplitId" TEXT,
    "repoPath" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    CONSTRAINT "ContentItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_previousVersionContentId_fkey" FOREIGN KEY ("previousVersionContentId") REFERENCES "ContentItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_currentSplitId_fkey" FOREIGN KEY ("currentSplitId") REFERENCES "SplitVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ContentItem" ("createdAt", "currentSplitId", "deletedAt", "deletedReason", "deliveryMode", "description", "featureOnProfile", "id", "manifestId", "ownerUserId", "previousVersionContentId", "priceSats", "repoPath", "status", "storefrontStatus", "title", "type", "updatedAt") SELECT "createdAt", "currentSplitId", "deletedAt", "deletedReason", "deliveryMode", "description", "featureOnProfile", "id", "manifestId", "ownerUserId", "previousVersionContentId", "priceSats", "repoPath", "status", "storefrontStatus", "title", "type", "updatedAt" FROM "ContentItem";
DROP TABLE "ContentItem";
ALTER TABLE "new_ContentItem" RENAME TO "ContentItem";
CREATE UNIQUE INDEX "ContentItem_manifestId_key" ON "ContentItem"("manifestId");
CREATE INDEX "ContentItem_ownerUserId_idx" ON "ContentItem"("ownerUserId");
CREATE INDEX "ContentItem_previousVersionContentId_idx" ON "ContentItem"("previousVersionContentId");
CREATE INDEX "ContentItem_repoPath_idx" ON "ContentItem"("repoPath");
CREATE INDEX "ContentItem_deletedAt_idx" ON "ContentItem"("deletedAt");
CREATE TABLE "new_Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "splitParticipantId" TEXT NOT NULL,
    "splitVersionId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "deliveryMethod" TEXT NOT NULL DEFAULT 'link',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "acceptedByUserId" TEXT,
    "acceptedIdentityRef" TEXT,
    "revokedAt" DATETIME,
    "tombstonedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invitation_splitParticipantId_fkey" FOREIGN KEY ("splitParticipantId") REFERENCES "SplitParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_splitVersionId_fkey" FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invitation" ("acceptedAt", "acceptedByUserId", "acceptedIdentityRef", "contentId", "createdAt", "deliveryMethod", "expiresAt", "id", "inviterUserId", "revokedAt", "splitParticipantId", "splitVersionId", "status", "targetType", "targetValue", "token", "tokenHash", "tombstonedAt", "updatedAt") SELECT "acceptedAt", "acceptedByUserId", "acceptedIdentityRef", "contentId", "createdAt", "deliveryMethod", "expiresAt", "id", "inviterUserId", "revokedAt", "splitParticipantId", "splitVersionId", "status", "targetType", "targetValue", "token", "tokenHash", "tombstonedAt", "updatedAt" FROM "Invitation";
DROP TABLE "Invitation";
ALTER TABLE "new_Invitation" RENAME TO "Invitation";
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_splitParticipantId_idx" ON "Invitation"("splitParticipantId");
CREATE INDEX "Invitation_splitVersionId_idx" ON "Invitation"("splitVersionId");
CREATE INDEX "Invitation_contentId_idx" ON "Invitation"("contentId");
CREATE INDEX "Invitation_inviterUserId_idx" ON "Invitation"("inviterUserId");
CREATE INDEX "Invitation_acceptedByUserId_idx" ON "Invitation"("acceptedByUserId");
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");
CREATE INDEX "Invitation_tokenHash_idx" ON "Invitation"("tokenHash");
CREATE TABLE "new_SplitParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitVersionId" TEXT NOT NULL,
    "participantEmail" TEXT,
    "participantUserId" TEXT,
    "invitationId" TEXT,
    "targetType" TEXT NOT NULL DEFAULT 'email',
    "targetValue" TEXT,
    "role" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL DEFAULT 'writer',
    "percent" DECIMAL NOT NULL,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "payoutIdentityId" TEXT,
    "acceptedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SplitParticipant_payoutIdentityId_fkey" FOREIGN KEY ("payoutIdentityId") REFERENCES "Identity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SplitParticipant_splitVersionId_fkey" FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SplitParticipant_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SplitParticipant" ("acceptedAt", "bps", "createdAt", "id", "invitationId", "participantEmail", "participantUserId", "payoutIdentityId", "percent", "role", "roleCode", "splitVersionId", "targetType", "targetValue", "verifiedAt") SELECT "acceptedAt", "bps", "createdAt", "id", "invitationId", "participantEmail", "participantUserId", "payoutIdentityId", "percent", "role", "roleCode", "splitVersionId", "targetType", "targetValue", "verifiedAt" FROM "SplitParticipant";
DROP TABLE "SplitParticipant";
ALTER TABLE "new_SplitParticipant" RENAME TO "SplitParticipant";
CREATE INDEX "SplitParticipant_splitVersionId_idx" ON "SplitParticipant"("splitVersionId");
CREATE INDEX "SplitParticipant_participantEmail_idx" ON "SplitParticipant"("participantEmail");
CREATE INDEX "SplitParticipant_invitationId_idx" ON "SplitParticipant"("invitationId");
CREATE INDEX "SplitParticipant_targetType_idx" ON "SplitParticipant"("targetType");
CREATE INDEX "SplitParticipant_payoutIdentityId_idx" ON "SplitParticipant"("payoutIdentityId");
CREATE UNIQUE INDEX "SplitParticipant_splitVersionId_participantEmail_key" ON "SplitParticipant"("splitVersionId", "participantEmail");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantPayout_payoutKey_key" ON "ParticipantPayout"("payoutKey");

