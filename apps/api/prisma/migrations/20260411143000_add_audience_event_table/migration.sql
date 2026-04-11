-- Add audience event tracking table for audience analytics.
CREATE TABLE "AudienceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" TEXT,
    "actorUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudienceEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AudienceEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AudienceEvent_contentId_eventType_createdAt_idx" ON "AudienceEvent"("contentId", "eventType", "createdAt");
CREATE INDEX "AudienceEvent_sessionId_contentId_eventType_createdAt_idx" ON "AudienceEvent"("sessionId", "contentId", "eventType", "createdAt");
CREATE INDEX "AudienceEvent_actorUserId_createdAt_idx" ON "AudienceEvent"("actorUserId", "createdAt");
