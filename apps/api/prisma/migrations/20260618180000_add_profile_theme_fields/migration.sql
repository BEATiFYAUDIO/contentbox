-- Public profile visual theme settings. Additive and backward-compatible.
ALTER TABLE "User" ADD COLUMN "themeWallpaperImageUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "themeMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "User" ADD COLUMN "themeAccentColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeBackgroundColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeCardColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeBorderColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeButtonColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeButtonTextColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeTextColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeMutedTextColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeGeneratedFromImage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "themeUpdatedAt" DATETIME;
