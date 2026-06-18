-- Add optional catalog origin marker for native Certifyd assets vs legacy-connected assets.
ALTER TABLE "ContentItem" ADD COLUMN "assetOrigin" TEXT NOT NULL DEFAULT 'native';

CREATE INDEX "ContentItem_assetOrigin_idx" ON "ContentItem"("assetOrigin");
