# Certifyd Player MVP

## North Star

A fan can discover a creator, press play, and support them directly.

## Product Boundary

- The Certifyd Player is the Fan PWA.
- Contentbox owns platform/API responsibilities: canonical playback contract, offer/playback authorization, public creator/profile pages, buy/support pages, and APIs.
- The Fan PWA owns discovery, playback UI, persistent player dock, continuous playback, and the collection/support experience.
- No cross-repo static asset copying. Each repo deploys independently.

## Discover → Play → Support Loop

1. Fan discovers creator/content in the Fan PWA or from a public creator/profile page.
2. Fan selects `Play in Certifyd` for playable audio/video content.
3. Contentbox profile pages hand off playable content to the Fan PWA.
4. The Fan PWA requests canonical offer/playback data from `/buy/content/:contentId/offer`.
5. Contentbox decides whether full playback, preview playback, or no playback is authorized.
6. The Fan PWA renders and plays only what `offer.playback` provides.
7. Support/buy actions remain near playback and link back to existing buy/support pages.

## Contentbox Responsibilities

- `/buy/content/:contentId/offer`, `/public/content/:contentId/offer`, and `/p2p/content/:contentId/offer` return canonical offer/playback data.
- `/buy/:contentId` remains the existing buy/support page.
- Public profile pages expose safe `Play in Certifyd` handoff links for playable content.
- Media-serving routes validate preview/tokenized stream access.
- Payment, permit, receipt, and entitlement routes remain the platform authority.

## Fan PWA Responsibilities

- Discovery feeds and creator/content browsing.
- Persistent player dock and playback controls.
- Continuous playback inside the Fan PWA app shell.
- Shared preview/full playback path using the canonical `offer.playback` object.
- Collection/support UX that links to platform buy/support routes when needed.

## Canonical Playback Contract

`/buy/content/:contentId/offer` includes a normalized `playback` object:

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

## Authorization Boundary

Playback authorization is handled by platform/API routes, especially:

- `handlePublicOffer` for canonical offer/playback state.
- `/buy/permits` for preview vs stream permits.
- Media-serving routes that validate preview/tokenized stream access.

The Fan PWA must treat these responses as authoritative and must not duplicate platform rules for paid/free eligibility, ownership, entitlement truth, preview length, pricing, or unlock availability.

## Explicitly Out Of Scope

- A separate Contentbox player dock/controller.
- Cross-repo static asset copying.
- Playlists.
- AI recommendations.
- Comments or chat.
- Native iOS/Android.
- Offline playback.
- Creator analytics.
- Node management.
- Social features.
