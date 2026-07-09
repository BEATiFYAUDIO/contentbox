# Playback Access Architecture

## Decision

Contentbox is the canonical playback authority. It owns payment, receipt, entitlement, and playback authorization decisions. The Fan PWA presents discovery and playback, but it does not determine ownership.

## System Boundary

Contentbox owns:

- Payments
- Receipts
- Entitlements
- Playback rules
- Access status

Fan PWA owns:

- Discovery UI
- Player UI
- Watch experience
- Local receipt proof cache
- Access hydration from the creator node

## Source of Truth

The Fan PWA must hydrate access from the creator node before treating paid content as owned or fully playable.

Canonical endpoints:

- `GET /buy/content/:contentId/access-status`
- `GET /buy/content/:contentId/offer`
- `GET /buy/receipts/:receiptToken/status`
- `GET /buy/receipts/r/:receiptId/status`

`/buy/content/:contentId/access-status` is the primary v1 endpoint for silently resolving the current buyer access state, discovering `receiptId` when entitled, and hydrating Fan receipt proof.

## Presentation

Both the contentbox buy page and Fan PWA can render playback, but they must consume the same access model from contentbox. The buy page can show purchase and receipt details directly. The Fan PWA should rehydrate access on return/focus/navigation and then feed the shared Watch/player resolver.

## Architecture

```text
               Contentbox
      (Canonical Playback Authority)
     ┌──────────────────────────────┐
     │ Payments                     │
     │ Receipts                     │
     │ Entitlements                 │
     │ Playback Rules               │
     │ Access Status                │
     └──────────────┬───────────────┘
                    │
        access-status / offer / receipts
                    │
      ┌─────────────┴─────────────┐
      │                           │
┌───────────────┐         ┌────────────────┐
│ Buy Page UI   │         │ Fan PWA Player │
│ Commerce UI   │         │ Discovery UI   │
└───────────────┘         └────────────────┘
```

## Must Not Happen

- Fan PWA must never infer ownership from discovery metadata.
- Fan PWA must never invent entitlements.
- Paid locked content must never fall back to full media URLs without contentbox-proven access.
- Preview/full playback decisions must not diverge between the buy page and Fan PWA.
- Discovery/card metadata is provisional UI data only, not authorization state.

## Future Compatibility

This boundary should hold for signed-in accounts, libraries, downloads, offline playback, native apps, casting, and future player surfaces. Those features can add identity or presentation layers, but contentbox remains the authority for whether the current viewer has access.
