-- AlterTable
ALTER TABLE "SplitVersion" ADD COLUMN     "lockedFileObjectKey" TEXT,
ADD COLUMN     "lockedFileSha256" TEXT;

-- CreateIndex
CREATE INDEX "SplitVersion_lockedFileSha256_idx" ON "SplitVersion"("lockedFileSha256");
