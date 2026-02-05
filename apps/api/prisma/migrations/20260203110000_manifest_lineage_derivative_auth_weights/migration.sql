ALTER TABLE "Manifest" ADD COLUMN IF NOT EXISTS "parentManifestSha256" TEXT;
ALTER TABLE "Manifest" ADD COLUMN IF NOT EXISTS "lineageRelation" "ContentLinkRelation";
CREATE INDEX IF NOT EXISTS "Manifest_parentManifestSha256_idx" ON "Manifest"("parentManifestSha256");

ALTER TABLE "DerivativeAuthorization" ADD COLUMN IF NOT EXISTS "approveWeightBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DerivativeAuthorization" ADD COLUMN IF NOT EXISTS "rejectWeightBps" INTEGER NOT NULL DEFAULT 0;
