-- Add publication manifest support for proven legacy works.
ALTER TABLE "ContentItem" ADD COLUMN "publicationManifestJson" JSONB;
ALTER TABLE "ContentItem" ADD COLUMN "publicationManifestSha256" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "publicationManifestGeneratedAt" DATETIME;
ALTER TABLE "ContentItem" ADD COLUMN "proofBundleType" TEXT NOT NULL DEFAULT 'none';
