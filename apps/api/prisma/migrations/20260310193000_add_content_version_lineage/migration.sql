-- Add explicit lineage to content versions.
ALTER TABLE "ContentItem" ADD COLUMN "previousVersionContentId" TEXT;

CREATE INDEX "ContentItem_previousVersionContentId_idx" ON "ContentItem"("previousVersionContentId");
