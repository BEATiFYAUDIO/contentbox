CREATE TYPE "StorefrontStatus" AS ENUM ('DISABLED', 'LISTED', 'UNLISTED');
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "storefrontStatus" "StorefrontStatus" NOT NULL DEFAULT 'DISABLED';
CREATE INDEX IF NOT EXISTS "ContentItem_storefrontStatus_idx" ON "ContentItem"("storefrontStatus");
