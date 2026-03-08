CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_contentId_idx" ON "ShareLink"("contentId");
CREATE INDEX "ShareLink_status_idx" ON "ShareLink"("status");

ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PublishEvent" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicUrl" TEXT NOT NULL,
    "targetHash" TEXT,
    "splitVersionId" TEXT,
    "clearanceId" TEXT,
    "priceSats" BIGINT,
    "publisherNodeId" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "PublishEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublishEvent_contentId_idx" ON "PublishEvent"("contentId");
CREATE INDEX "PublishEvent_status_idx" ON "PublishEvent"("status");
CREATE INDEX "PublishEvent_splitVersionId_idx" ON "PublishEvent"("splitVersionId");

ALTER TABLE "PublishEvent" ADD CONSTRAINT "PublishEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
