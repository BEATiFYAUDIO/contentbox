CREATE TABLE IF NOT EXISTS "DerivativeAuthorization" (
  "id" TEXT NOT NULL,
  "derivativeLinkId" TEXT NOT NULL,
  "parentContentId" TEXT NOT NULL,
  "requiredApprovers" INTEGER NOT NULL,
  "approvedApprovers" INTEGER NOT NULL DEFAULT 0,
  "approvalPolicy" TEXT NOT NULL,
  "approvalBpsTarget" INTEGER,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DerivativeAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DerivativeApprovalVote" (
  "id" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "approverUserId" TEXT NOT NULL,
  "approverSplitParticipantId" TEXT,
  "decision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DerivativeApprovalVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DerivativeAuthorization_derivativeLinkId_idx" ON "DerivativeAuthorization"("derivativeLinkId");
CREATE INDEX IF NOT EXISTS "DerivativeAuthorization_parentContentId_idx" ON "DerivativeAuthorization"("parentContentId");
CREATE INDEX IF NOT EXISTS "DerivativeAuthorization_status_idx" ON "DerivativeAuthorization"("status");

CREATE INDEX IF NOT EXISTS "DerivativeApprovalVote_authorizationId_idx" ON "DerivativeApprovalVote"("authorizationId");
CREATE INDEX IF NOT EXISTS "DerivativeApprovalVote_approverUserId_idx" ON "DerivativeApprovalVote"("approverUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "DerivativeApprovalVote_authorizationId_approverUserId_key" ON "DerivativeApprovalVote"("authorizationId", "approverUserId");

ALTER TABLE "DerivativeAuthorization" ADD CONSTRAINT "DerivativeAuthorization_derivativeLinkId_fkey" FOREIGN KEY ("derivativeLinkId") REFERENCES "ContentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DerivativeApprovalVote" ADD CONSTRAINT "DerivativeApprovalVote_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "DerivativeAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
