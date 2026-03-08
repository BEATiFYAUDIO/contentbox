-- Clearance requests + external approval tokens
CREATE TABLE IF NOT EXISTS "ClearanceRequest" (
  "id" TEXT NOT NULL,
  "contentLinkId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClearanceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApprovalToken" (
  "id" TEXT NOT NULL,
  "contentLinkId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "approverEmail" TEXT NOT NULL,
  "weightBps" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "decision" TEXT,
  "upstreamRatePercent" DECIMAL(10,3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ClearanceRequest_contentLinkId_idx" ON "ClearanceRequest"("contentLinkId");
CREATE INDEX IF NOT EXISTS "ClearanceRequest_requestedByUserId_idx" ON "ClearanceRequest"("requestedByUserId");
CREATE INDEX IF NOT EXISTS "ClearanceRequest_status_idx" ON "ClearanceRequest"("status");
CREATE INDEX IF NOT EXISTS "ApprovalToken_contentLinkId_idx" ON "ApprovalToken"("contentLinkId");
CREATE INDEX IF NOT EXISTS "ApprovalToken_approverEmail_idx" ON "ApprovalToken"("approverEmail");
CREATE INDEX IF NOT EXISTS "ApprovalToken_expiresAt_idx" ON "ApprovalToken"("expiresAt");

ALTER TABLE "ClearanceRequest" ADD CONSTRAINT "ClearanceRequest_contentLinkId_fkey" FOREIGN KEY ("contentLinkId") REFERENCES "ContentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalToken" ADD CONSTRAINT "ApprovalToken_contentLinkId_fkey" FOREIGN KEY ("contentLinkId") REFERENCES "ContentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
