-- Mobile wallpaper focal point controls for public profile appearance.
ALTER TABLE "User" ADD COLUMN "themeMobileWallpaperFocusX" REAL NOT NULL DEFAULT 50;
ALTER TABLE "User" ADD COLUMN "themeMobileWallpaperFocusY" REAL NOT NULL DEFAULT 50;

-- Map existing coarse focus values into focal-point defaults.
UPDATE "User"
SET "themeMobileWallpaperFocusX" = 50,
    "themeMobileWallpaperFocusY" = CASE
      WHEN "themeMobileWallpaperFocus" = 'top' THEN 0
      WHEN "themeMobileWallpaperFocus" = 'bottom' THEN 100
      ELSE 50
    END;
