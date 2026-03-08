-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedReason" TEXT;

-- CreateIndex
CREATE INDEX "ContentItem_deletedAt_idx" ON "ContentItem"("deletedAt");
