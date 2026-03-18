-- Invitation claim refactor (identity-bound acceptance model)

ALTER TABLE "SplitParticipant" ADD COLUMN "invitationId" TEXT;
ALTER TABLE "SplitParticipant" ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "SplitParticipant" ADD COLUMN "targetValue" TEXT;

ALTER TABLE "Invitation" ADD COLUMN "token" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "splitVersionId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "contentId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "inviterUserId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "targetType" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "targetValue" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "deliveryMethod" TEXT NOT NULL DEFAULT 'link';
ALTER TABLE "Invitation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Invitation" ADD COLUMN "acceptedByUserId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "acceptedIdentityRef" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "Invitation" ADD COLUMN "tombstonedAt" DATETIME;
ALTER TABLE "Invitation" ADD COLUMN "updatedAt" DATETIME;

UPDATE "Invitation"
SET "token" = COALESCE(NULLIF("token", ''), 'legacy_' || "id")
WHERE "token" IS NULL OR "token" = '';

UPDATE "Invitation"
SET "status" = CASE
  WHEN "acceptedAt" IS NOT NULL THEN 'accepted'
  WHEN "expiresAt" < CURRENT_TIMESTAMP THEN 'expired'
  ELSE 'pending'
END
WHERE "status" IS NULL OR "status" = '';

UPDATE "Invitation"
SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;

UPDATE "Invitation" AS i
SET
  "splitVersionId" = sp."splitVersionId",
  "contentId" = sv."contentId",
  "inviterUserId" = c."ownerUserId",
  "targetType" = CASE
    WHEN sp."participantUserId" IS NOT NULL AND sp."participantUserId" <> '' THEN 'local_user'
    WHEN COALESCE(sp."participantEmail", '') <> '' AND instr(sp."participantEmail", '@') = 0 THEN 'local_user'
    ELSE 'email'
  END,
  "targetValue" = CASE
    WHEN sp."participantUserId" IS NOT NULL AND sp."participantUserId" <> '' THEN sp."participantUserId"
    WHEN COALESCE(sp."participantEmail", '') <> '' AND instr(sp."participantEmail", '@') = 0 THEN sp."participantEmail"
    ELSE COALESCE(sp."participantEmail", '')
  END
FROM "SplitParticipant" sp
JOIN "SplitVersion" sv ON sv."id" = sp."splitVersionId"
JOIN "ContentItem" c ON c."id" = sv."contentId"
WHERE i."splitParticipantId" = sp."id"
  AND (
    i."splitVersionId" IS NULL OR
    i."contentId" IS NULL OR
    i."inviterUserId" IS NULL OR
    i."targetType" IS NULL OR
    i."targetValue" IS NULL
  );

UPDATE "SplitParticipant"
SET
  "targetType" = CASE
    WHEN "participantUserId" IS NOT NULL AND "participantUserId" <> '' THEN 'local_user'
    WHEN COALESCE("participantEmail", '') <> '' AND instr("participantEmail", '@') = 0 THEN 'local_user'
    ELSE 'email'
  END,
  "targetValue" = CASE
    WHEN "participantUserId" IS NOT NULL AND "participantUserId" <> '' THEN "participantUserId"
    WHEN COALESCE("participantEmail", '') <> '' AND instr("participantEmail", '@') = 0 THEN "participantEmail"
    ELSE COALESCE("participantEmail", '')
  END
WHERE "targetValue" IS NULL OR "targetValue" = '';

UPDATE "SplitParticipant" AS sp
SET "invitationId" = (
  SELECT i."id"
  FROM "Invitation" i
  WHERE i."splitParticipantId" = sp."id"
  ORDER BY i."createdAt" DESC
  LIMIT 1
)
WHERE sp."invitationId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX IF NOT EXISTS "Invitation_status_idx" ON "Invitation"("status");
CREATE INDEX IF NOT EXISTS "Invitation_splitVersionId_idx" ON "Invitation"("splitVersionId");
CREATE INDEX IF NOT EXISTS "Invitation_contentId_idx" ON "Invitation"("contentId");
CREATE INDEX IF NOT EXISTS "Invitation_inviterUserId_idx" ON "Invitation"("inviterUserId");
CREATE INDEX IF NOT EXISTS "Invitation_acceptedByUserId_idx" ON "Invitation"("acceptedByUserId");
CREATE INDEX IF NOT EXISTS "SplitParticipant_invitationId_idx" ON "SplitParticipant"("invitationId");
CREATE INDEX IF NOT EXISTS "SplitParticipant_targetType_idx" ON "SplitParticipant"("targetType");
