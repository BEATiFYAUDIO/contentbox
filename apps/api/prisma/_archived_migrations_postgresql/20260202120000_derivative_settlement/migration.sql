-- CreateEnum
CREATE TYPE "ContentLinkRelation" AS ENUM ('remix', 'mashup', 'derivative');

-- CreateEnum
CREATE TYPE "SplitRole" AS ENUM ('writer', 'producer', 'publisher', 'performer', 'other');

-- CreateEnum
CREATE TYPE "PaymentRail" AS ENUM ('lightning', 'onchain');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('pending', 'paid', 'failed', 'expired');

-- AlterTable ContentItem
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "manifestId" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "currentSplitId" TEXT;

-- AlterTable ContentFile
ALTER TABLE "ContentFile" ADD COLUMN IF NOT EXISTS "cipherSha256" TEXT;
ALTER TABLE "ContentFile" ALTER COLUMN "sizeBytes" TYPE BIGINT;

-- AlterTable SplitVersion
ALTER TABLE "SplitVersion" ADD COLUMN IF NOT EXISTS "lockedManifestSha256" TEXT;

-- AlterTable SplitParticipant
ALTER TABLE "SplitParticipant" ALTER COLUMN "participantEmail" DROP NOT NULL;
ALTER TABLE "SplitParticipant" ADD COLUMN IF NOT EXISTS "roleCode" "SplitRole" NOT NULL DEFAULT 'writer';
ALTER TABLE "SplitParticipant" ADD COLUMN IF NOT EXISTS "bps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable Manifest
CREATE TABLE IF NOT EXISTS "Manifest" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "encAlg" TEXT,
    "keyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Manifest_contentId_key" ON "Manifest"("contentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Manifest_sha256_key" ON "Manifest"("sha256");

-- CreateTable ContentLink
CREATE TABLE IF NOT EXISTS "ContentLink" (
    "id" TEXT NOT NULL,
    "parentContentId" TEXT NOT NULL,
    "childContentId" TEXT NOT NULL,
    "relation" "ContentLinkRelation" NOT NULL,
    "upstreamBps" INTEGER NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,

    CONSTRAINT "ContentLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContentLink_parentContentId_idx" ON "ContentLink"("parentContentId");
CREATE INDEX IF NOT EXISTS "ContentLink_childContentId_idx" ON "ContentLink"("childContentId");

-- CreateTable PaymentIntent
CREATE TABLE IF NOT EXISTS "PaymentIntent" (
    "id" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "contentId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'pending',
    "paidVia" "PaymentRail" NOT NULL,
    "bolt11" TEXT,
    "providerId" TEXT,
    "onchainAddress" TEXT,
    "onchainTxid" TEXT,
    "onchainVout" INTEGER,
    "confirmations" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentIntent_contentId_idx" ON "PaymentIntent"("contentId");
CREATE INDEX IF NOT EXISTS "PaymentIntent_buyerUserId_idx" ON "PaymentIntent"("buyerUserId");
CREATE INDEX IF NOT EXISTS "PaymentIntent_manifestSha256_idx" ON "PaymentIntent"("manifestSha256");

-- CreateTable Entitlement
CREATE TABLE IF NOT EXISTS "Entitlement" (
    "id" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "contentId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_buyerUserId_contentId_manifestSha256_key" ON "Entitlement"("buyerUserId", "contentId", "manifestSha256");

-- CreateTable Settlement
CREATE TABLE IF NOT EXISTS "Settlement" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "splitVersionId" TEXT NOT NULL,
    "netAmountSats" BIGINT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Settlement_paymentIntentId_key" ON "Settlement"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "Settlement_contentId_idx" ON "Settlement"("contentId");
CREATE INDEX IF NOT EXISTS "Settlement_splitVersionId_idx" ON "Settlement"("splitVersionId");

-- CreateTable SettlementLine
CREATE TABLE IF NOT EXISTS "SettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantEmail" TEXT,
    "role" TEXT,
    "amountSats" BIGINT NOT NULL,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SettlementLine_settlementId_idx" ON "SettlementLine"("settlementId");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_currentSplitId_fkey" FOREIGN KEY ("currentSplitId") REFERENCES "SplitVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_parentContentId_fkey" FOREIGN KEY ("parentContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_childContentId_fkey" FOREIGN KEY ("childContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_splitVersionId_fkey" FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
