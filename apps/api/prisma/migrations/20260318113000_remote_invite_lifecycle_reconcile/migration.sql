-- Add lifecycle/status fields for remote invite reconciliation.
ALTER TABLE "RemoteInvite" ADD COLUMN "contentStatus" TEXT;
ALTER TABLE "RemoteInvite" ADD COLUMN "splitStatus" TEXT;
ALTER TABLE "RemoteInvite" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "RemoteInvite" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "RemoteInvite" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "RemoteInvite" ADD COLUMN "tombstonedAt" DATETIME;

UPDATE "RemoteInvite"
SET "status" = CASE
  WHEN "acceptedAt" IS NOT NULL THEN 'accepted'
  ELSE 'pending'
END
WHERE "status" IS NULL OR TRIM("status") = '';
