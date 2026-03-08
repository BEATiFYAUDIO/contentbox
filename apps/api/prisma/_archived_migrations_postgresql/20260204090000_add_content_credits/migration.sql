CREATE TABLE IF NOT EXISTS "ContentCredit" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContentCredit_contentId_sortOrder_idx" ON "ContentCredit"("contentId", "sortOrder");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentCredit_contentId_fkey') THEN
    ALTER TABLE "ContentCredit" ADD CONSTRAINT "ContentCredit_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
