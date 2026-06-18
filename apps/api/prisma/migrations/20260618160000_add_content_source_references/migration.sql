-- Source account references for connected Legacy assets.
CREATE TABLE "ContentSourceReference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contentId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceAccount" TEXT,
  "sourceAccountUrl" TEXT,
  "sourceProofSubject" TEXT,
  "sourceProofRecordId" TEXT,
  "sourceVerified" BOOLEAN NOT NULL DEFAULT false,
  "resolver" TEXT NOT NULL,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentSourceReference_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContentSourceReference_contentId_idx" ON "ContentSourceReference"("contentId");
CREATE INDEX "ContentSourceReference_platform_sourceAccount_idx" ON "ContentSourceReference"("platform", "sourceAccount");
CREATE INDEX "ContentSourceReference_sourceProofRecordId_idx" ON "ContentSourceReference"("sourceProofRecordId");
