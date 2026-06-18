-- Add quick public profile theme adjustment fields.
ALTER TABLE "User" ADD COLUMN "themeAccentOverrideColor" TEXT;
ALTER TABLE "User" ADD COLUMN "themeCardStrength" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "User" ADD COLUMN "themeOverlayStrength" TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE "User" ADD COLUMN "themeButtonStyle" TEXT NOT NULL DEFAULT 'glass';
