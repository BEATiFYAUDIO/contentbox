-- Add optional, private asset/catalog compatibility identifiers for content records.
CREATE TABLE "ContentExternalIdentifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "displayValue" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "issuer" TEXT,
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "creatorApprovedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentExternalIdentifier_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentExternalIdentifier_contentId_type_normalizedValue_key" ON "ContentExternalIdentifier"("contentId", "type", "normalizedValue");
CREATE INDEX "ContentExternalIdentifier_contentId_idx" ON "ContentExternalIdentifier"("contentId");
CREATE INDEX "ContentExternalIdentifier_type_normalizedValue_idx" ON "ContentExternalIdentifier"("type", "normalizedValue");
