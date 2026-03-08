/*
  Warnings:

  - You are about to alter the column `percent` on the `SplitParticipant` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,3)`.
  - A unique constraint covering the columns `[contentId,objectKey]` on the table `ContentFile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[splitVersionId,participantEmail]` on the table `SplitParticipant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ContentFile" ADD COLUMN     "dekNonce" TEXT,
ADD COLUMN     "fileNonce" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "repoPath" TEXT;

-- AlterTable
ALTER TABLE "SplitParticipant" ALTER COLUMN "percent" SET DATA TYPE DECIMAL(10,3);

-- CreateIndex
CREATE INDEX "ContentFile_sha256_idx" ON "ContentFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ContentFile_contentId_objectKey_key" ON "ContentFile"("contentId", "objectKey");

-- CreateIndex
CREATE INDEX "ContentItem_repoPath_idx" ON "ContentItem"("repoPath");

-- CreateIndex
CREATE UNIQUE INDEX "SplitParticipant_splitVersionId_participantEmail_key" ON "SplitParticipant"("splitVersionId", "participantEmail");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");
