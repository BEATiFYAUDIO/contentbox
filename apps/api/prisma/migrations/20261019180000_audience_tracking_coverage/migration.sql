-- Activation is per creator; operational windows are shared by the local Core instance.
CREATE TABLE "AudienceTrackingActivation" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "activatedAt" DATETIME NOT NULL,
  "freshAccount" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AudienceTrackingActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AudienceTrackingWindow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "startedAt" DATETIME NOT NULL,
  "coveredUntil" DATETIME NOT NULL,
  "endedAt" DATETIME
);
CREATE INDEX "AudienceTrackingWindow_startedAt_coveredUntil_idx" ON "AudienceTrackingWindow"("startedAt", "coveredUntil");
