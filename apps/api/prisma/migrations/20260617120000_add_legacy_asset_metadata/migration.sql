-- Add normalized display metadata for connected legacy catalog assets.
ALTER TABLE "ContentItem" ADD COLUMN "legacyArtist" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyReleaseDate" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyProvider" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyArtworkUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyExternalUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacySpotifyUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyAppleMusicUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyYoutubeUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyMusicBrainzUrl" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "legacyDiscogsUrl" TEXT;
