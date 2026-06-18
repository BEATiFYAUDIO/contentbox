# Connect Work

Connect Work lets creators connect an existing work to their Certifyd catalog using an industry identifier or a public music/video URL.

It is designed for legacy catalog entries: works that already exist outside Certifyd and need to be represented in the creator's local catalog before any future ownership, verification, or sovereign-copy workflow.

## Certifyd Works vs Legacy

Certifyd has two Works views:

- **Certifyd Works**: native Certifyd assets created and managed inside Certifyd. `ContentItem.id` remains the canonical Certifyd Asset ID.
- **Legacy**: connected metadata references for works that exist on external platforms or in industry catalogs.

Legacy assets are not ownership verification. They do not prove control of a Spotify, Apple Music, YouTube, label, publisher, distributor, PRO, or catalog account.

Legacy assets remain distinct from Certifyd Works until a later upgrade flow creates a sovereign copy or approved verification path.

## Supported Inputs

Connect Work currently supports these identifier inputs:

- ISRC
- UPC
- ISWC
- DOI
- ISBN
- EIDR

Connect Work also supports these URL inputs:

- Spotify URL
- Apple Music URL
- YouTube URL

## Retrieved Metadata

Depending on the input and available metadata providers, Connect Work may retrieve:

- Title
- Artist
- Release title
- Release date
- Artwork
- External links
- Industry identifiers

Metadata availability varies by provider and by the quality of public catalog data.

## Metadata Providers

Connect Work can use multiple metadata sources:

- MusicBrainz
- Cover Art Archive
- Optional Discogs fallback
- Spotify oEmbed fallback
- Optional Spotify Web API enrichment

Provider metadata is normalized before being saved. Certifyd does not store raw provider payloads for Connected Legacy assets.

## Catalog Result

When a work is connected, Certifyd creates a normal catalog record with:

- `assetOrigin = legacy_import`
- A canonical Certifyd Asset ID (`ContentItem.id`)
- Optional normalized legacy metadata
- Optional industry identifiers through `ContentExternalIdentifier`

The work appears in:

`Works → Legacy`

It does not appear as a native Certifyd Work.

## Ownership and Verification

Connected Legacy assets are private catalog metadata references. They should be treated as unverified until a future verification or upgrade workflow exists.

Do not describe a Legacy asset as:

- Verified
- Owned
- Certifyd
- Sovereign

Safe language:

- Connected from Spotify
- Connected from Apple Music
- Connected from YouTube
- Legacy
- Connected legacy asset
