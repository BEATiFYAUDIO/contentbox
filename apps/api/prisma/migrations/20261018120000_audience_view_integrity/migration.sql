-- Existing AudienceEvent rows remain legacy opens (definition IS NULL).
ALTER TABLE "AudienceEvent" ADD COLUMN "definition" TEXT;
CREATE INDEX "AudienceEvent_definition_createdAt_idx" ON "AudienceEvent"("definition", "createdAt");

-- One atomic rolling-window claim per browser session and work.
CREATE TABLE "AudienceViewClaim" (
    "contentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lastRecordedAtMs" BIGINT NOT NULL,
    PRIMARY KEY ("contentId", "sessionId")
);
CREATE INDEX "AudienceViewClaim_lastRecordedAtMs_idx" ON "AudienceViewClaim"("lastRecordedAtMs");
