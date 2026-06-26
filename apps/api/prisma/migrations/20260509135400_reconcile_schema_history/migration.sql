-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "receiptId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DerivativeApprovalVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorizationId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "approverSplitParticipantId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DerivativeApprovalVote_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "DerivativeAuthorization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DerivativeApprovalVote" ("approverSplitParticipantId", "approverUserId", "authorizationId", "createdAt", "decision", "id") SELECT "approverSplitParticipantId", "approverUserId", "authorizationId", "createdAt", "decision", "id" FROM "DerivativeApprovalVote";
DROP TABLE "DerivativeApprovalVote";
ALTER TABLE "new_DerivativeApprovalVote" RENAME TO "DerivativeApprovalVote";
CREATE INDEX "DerivativeApprovalVote_authorizationId_idx" ON "DerivativeApprovalVote"("authorizationId");
CREATE INDEX "DerivativeApprovalVote_approverUserId_idx" ON "DerivativeApprovalVote"("approverUserId");
CREATE INDEX "DerivativeApprovalVote_approverSplitParticipantId_idx" ON "DerivativeApprovalVote"("approverSplitParticipantId");
CREATE UNIQUE INDEX "DerivativeApprovalVote_authorizationId_approverSplitParticipantId_key" ON "DerivativeApprovalVote"("authorizationId", "approverSplitParticipantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_receiptId_key" ON "PaymentIntent"("receiptId");

-- CreateIndex
CREATE INDEX "PaymentIntent_receiptId_idx" ON "PaymentIntent"("receiptId");
