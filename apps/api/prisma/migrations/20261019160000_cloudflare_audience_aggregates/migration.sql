-- Optional, creator-scoped Cloudflare Analytics connection and aggregate-only cache.
CREATE TABLE "CloudflareAnalyticsConnection" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "zoneId" TEXT NOT NULL,
  "accountId" TEXT,
  "hostname" TEXT NOT NULL,
  "tokenCiphertext" TEXT NOT NULL,
  "tokenIv" TEXT NOT NULL,
  "tokenTag" TEXT NOT NULL,
  "lastCheckedAt" DATETIME,
  "lastSyncAt" DATETIME,
  "lastStatus" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CloudflareAnalyticsConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CloudflareAnalyticsSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "rowsJson" TEXT NOT NULL,
  "sampleInterval" REAL,
  "coverage" TEXT NOT NULL,
  "fetchedAt" DATETIME NOT NULL,
  "committed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CloudflareAnalyticsSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CloudflareAnalyticsSnapshot_userId_zoneId_hostname_source_metric_day_fetchedAt_key"
  ON "CloudflareAnalyticsSnapshot"("userId", "zoneId", "hostname", "source", "metric", "day", "fetchedAt");
CREATE INDEX "CloudflareAnalyticsSnapshot_userId_zoneId_hostname_fetchedAt_idx"
  ON "CloudflareAnalyticsSnapshot"("userId", "zoneId", "hostname", "fetchedAt");
CREATE INDEX "CloudflareAnalyticsSnapshot_userId_source_metric_day_idx"
  ON "CloudflareAnalyticsSnapshot"("userId", "source", "metric", "day");
