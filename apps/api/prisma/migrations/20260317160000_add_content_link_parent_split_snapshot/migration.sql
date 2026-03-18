-- Snapshot parent locked split version on derivative link creation.
ALTER TABLE "ContentLink" ADD COLUMN "parentSplitVersionId" TEXT;

CREATE INDEX "ContentLink_parentSplitVersionId_idx"
ON "ContentLink"("parentSplitVersionId");
