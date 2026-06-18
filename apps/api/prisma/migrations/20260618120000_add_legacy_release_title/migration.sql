-- Add normalized release/album title metadata for connected legacy works.
ALTER TABLE "ContentItem" ADD COLUMN "legacyReleaseTitle" TEXT;
