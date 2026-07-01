# Certifyd Player MVP

## North Star

A fan can discover a creator, press play, and support them directly.

## Product Boundary

- The Fan PWA is the discovery experience: creator profiles, discoverable content, and entry links.
- The Player is the listening/playback experience: it renders playback that the platform has already authorized.
- The Player must not duplicate entitlement, pricing, ownership, preview-duration, or unlock eligibility logic.

## Discover → Play → Support Loop

1. Fan lands on a creator profile or discovery feed.
2. Fan selects `Play in Certifyd` for playable audio/video content.
3. Stage 1A intercepts playable profile-card links and opens an in-page mini-player dock.
4. The mini-player requests canonical offer/playback data from `/buy/content/:contentId/offer`.
5. The platform response determines whether full playback or preview playback is available.
6. The same player render path plays full or preview media.
7. If preview access ends, the support/unlock action remains near playback.

## What Exists Today

### Discovery Routes

- `/u/:handle` renders the public creator profile and featured works.
- `/public/discoverable-content` returns public discovery-feed content.
- `/public/discovery/signals` returns discovery signal metadata.
- `/public/content/:id`, `/public/content/:id/context`, and `/public/content/:id/attribution` expose public content context.

### Watch / Play Routes

- `/buy/:contentId` is the public player/support page.
- `/buy/content/:contentId/offer`, `/public/content/:contentId/offer`, and `/p2p/content/:contentId/offer` return canonical offer/playback data.
- `/public/content/:id/preview-file` serves preview/full media according to platform authorization.
- `/content/:manifestHash/:fileId` supports tokenized stream playback for unlocked/permit-backed access.

### Current Player Components

- The public player is server-rendered in `apps/api/src/server.ts` inside the `/buy/:contentId` page script.
- Dashboard library playback exists separately in `apps/dashboard/src/pages/LibraryPage.tsx` for private/owned library use.

### Offer / Unlock Flow

- The player requests `/buy/content/:contentId/offer`.
- Paid flows request permits through `/buy/permits` and payment through platform payment routes.
- Receipt/entitlement state is stored client-side only as a playback token cache; platform APIs remain the authority.

### Preview / Full Playback Logic

- The offer response exposes a normalized `playback` object and keeps legacy fields such as `previewUrl`, `fullMediaUrl`, `fullContentUrl`, `hasFullAccess`, `owned`, `isFree`, `priceSats`, `primaryFileId`, and `previewObjectKey` for backward compatibility.
- The player now routes preview and full media through the same small authorized playback render helper.
- Preview limits are applied only when the platform grants preview entitlement.

### Fan PWA APIs Used

- `/public/discoverable-content`
- `/public/discovery/signals`
- `/buy/content/:contentId/offer`
- `/api/buyer/bootstrap`
- `/api/buyer/me`
- `/api/buyer/entitlements`
- `/buy/permits`
- payment intent and receipt routes used by the existing buy flow

## Canonical Playback Contract

`/buy/content/:contentId/offer` now includes a normalized `playback` object:

```ts
playback: {
  mode: "full" | "preview" | "none";
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
}
```

Rules:

- The platform decides `mode`, `streamUrl`, `previewLimitSeconds`, and `canPlayFull`.
- The player renders `playback.streamUrl` and does not infer pricing, ownership, or unlock eligibility.
- Legacy fields like `previewUrl`, `fullMediaUrl`, `fullContentUrl`, `hasFullAccess`, and `priceSats` remain for backward compatibility while clients migrate.
- `mode: "full"` means uninterrupted full playback is available.
- `mode: "preview"` means preview playback is available and support/unlock UI should remain nearby.
- `mode: "none"` means the platform did not authorize a playable stream for this offer response.

## Where Authorization Lives

Playback authorization is handled by platform/API routes, especially:

- `handlePublicOffer` for canonical offer/playback state.
- `/buy/permits` for preview vs stream permits.
- media-serving routes that validate preview/tokenized stream access.

The player should continue treating these responses as authoritative.

## Duplicated UI Logic To Avoid Growing

The public player still contains presentation decisions around labels, buttons, and receipt display. That is acceptable for MVP. It should not grow into a second copy of platform rules for:

- paid vs free eligibility
- ownership
- entitlement truth
- preview length
- pricing
- unlock availability

## What Is Missing

- A dedicated standalone Player app does not exist yet; the MVP player is the existing `/buy/:contentId` surface.
- Discovery feed UI is API-backed, but there is no separate React Fan PWA player shell.
- Stage 1A implements an in-page mini-player on server-rendered public profile pages. It persists while the fan stays on that page, but not across full-page navigation.
- No explicit `/watch/:contentId` route exists; `/buy/:contentId` is the current watch/play/support route.
- Some older clients may still read legacy offer fields until they migrate fully to `playback`.


## Stage 1A Mini-Player

Stage 1A adds the smallest persistent player surface that fits the existing server-rendered Fan PWA pages:

- Public profile `Play in Certifyd` links are intercepted in-page.
- The mini-player fetches `/buy/content/:contentId/offer` and consumes only `offer.playback` for stream selection.
- The dock shows play/pause, progress, title, creator, artwork, and a Support/Buy link to the existing `/buy/:contentId` page.
- Preview and full playback use the same player path.
- `playback.mode: "none"` or a missing `streamUrl` fails gracefully without attempting playback.
- This does not add entitlement, pricing, ownership, or unlock logic to the player.

Stage 1A is in-page continuous playback only. Playback persists while users interact with the current public profile page because the link is intercepted and the page does not navigate.

## Stage 1B Requirement

Cross-page persistence requires a client-side app shell/PWA route that owns navigation and keeps the player mounted while views change. Server-rendered full-page navigation will unload the document and stop media, so true cross-page persistence is explicitly Stage 1B.

## Explicitly Out Of Scope

- Playlists
- AI recommendations
- Comments
- Chat
- Native iOS/Android
- Offline playback
- Creator analytics
- Node management
- Social features

## Smallest Implementation Path

1. Keep creator profiles and discovery feeds as the entry point.
2. Use `Play in Certifyd` links for playable audio/video content.
3. Keep `/buy/:contentId` as the MVP player/support page.
4. Continue requesting `/buy/content/:contentId/offer` before playback.
5. Keep new playback clients on the normalized `playback` object while preserving legacy offer fields during migration.
6. Stage 1A mini-player remains in-page only; Stage 1B requires a client-side shell for cross-page persistence.
