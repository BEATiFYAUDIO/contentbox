-- Add recovery key + token version to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryKeyHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryKeyCreatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
