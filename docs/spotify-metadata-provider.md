# Spotify Metadata Provider

Spotify metadata enrichment is optional. Certifyd works without Spotify API credentials.

Without Spotify credentials, Connect Work can still use fallback metadata providers such as MusicBrainz, Cover Art Archive, optional Discogs, and Spotify oEmbed.

## What Spotify Web API Adds

When configured, Spotify Web API can improve Spotify URL discovery with richer metadata:

- Artist
- Release title
- Release date
- ISRC
- UPC where available
- Artwork
- Spotify URL

Availability depends on what Spotify returns for the track or album.

## Create a Spotify Developer App

1. Go to the Spotify Developer Dashboard.
2. Create an app.
3. Use an app name such as:
   - `Certifyd`
4. Use an app description such as:
   - `Optional metadata enrichment provider for Certifyd Connect Work.`
5. Set website to:
   - `https://certifyd.me`
6. Add a redirect URI. Certifyd does not use Spotify user OAuth for Connect Work, but Spotify may require a value during app setup. Use one of:
   - `https://certifyd.me/callback`
   - a local callback URI if your Spotify app setup requires one
7. Select Web API only.
8. Copy the Client ID and Client Secret.

## Configure in Certifyd

In the dashboard:

`Dashboard → Configuration → Local LND Wallet → Metadata Providers`

Then:

1. Paste the Spotify Client ID.
2. Paste the Spotify Client Secret.
3. Click **Save Spotify**.
4. Click **Test connection**.

If the test passes, Connect Work will use Spotify rich metadata for Spotify URLs.

## Fallback Mode

Spotify is not required. If Spotify credentials are missing or unavailable, Connect Work falls back to available sources:

- MusicBrainz
- Cover Art Archive
- Optional Discogs
- Spotify oEmbed

Spotify oEmbed can usually return title, artwork, and the source link, but it does not provide the same rich fields as Spotify Web API.

## Security

Spotify credentials are node-local infrastructure configuration.

Certifyd stores Spotify metadata provider credentials locally and encrypts the client secret at rest using the existing node secret encryption helper.

Certifyd does not:

- Display the client secret after save
- Expose the client secret publicly
- Attach Spotify credentials to creator profile data
- Attach Spotify credentials to catalog assets
- Require Spotify OAuth user login

## P2P Philosophy

Spotify is only an optional enrichment provider.

No commercial API is required to run a Certifyd node. The node can still operate, publish, sell, and connect works without Spotify credentials.
