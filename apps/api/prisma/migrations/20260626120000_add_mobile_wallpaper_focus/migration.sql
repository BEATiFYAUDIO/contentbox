-- Mobile wallpaper crop focus for public profile appearance.
ALTER TABLE "User" ADD COLUMN "themeMobileWallpaperFocus" TEXT NOT NULL DEFAULT 'center';
