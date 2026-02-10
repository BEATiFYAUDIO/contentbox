# Buy Links, Endpoints, and Delivery Selection (Public + LAN)

This document describes how ContentBox chooses endpoints for buy flow and streaming, and how to verify it.

## Offer endpoint
`GET /p2p/content/:contentId/offer`

Expected payload fields (relevant):
- `seller.hostOrigin`
- `sellerEndpoints[]` (ordered list, public first)
- `manifestSha256`
- `priceSats`

## Public vs LAN ordering
The API builds endpoints using:
- `CONTENTBOX_PUBLIC_ORIGIN` (or `CONTENTBOX_PUBLIC_ORIGIN_FALLBACK`) for **public** base URL
- detected LAN base URL for **local** fallback

Rules:
- `sellerEndpoints[0]` should be the **public** endpoint.
- `sellerEndpoints[1]` should be the **LAN** endpoint (if available).
- Never emit `localhost` or `127.0.0.1` as a buyer-facing endpoint.

## Buy page selection logic (current)
- **apiBase** defaults to `sellerEndpoints[0].baseUrl` (public/tunnel).
- **streamBase** defaults to the same public base.
- If a LAN endpoint exists, the UI probes `${lanBase}/health` with a short timeout (~450ms):
  - If it responds, **streaming switches to LAN**.
  - Payments remain on the public endpoint.

This keeps payments robust over LTE/5G while still using LAN when available.

## Endpoints used by the buy flow
- Create intent: `POST /api/payments/intents`
- Poll refresh: `POST /api/payments/intents/:id/refresh` (body `{}`)
- Receipt fulfill: `GET /public/receipts/:receiptToken/fulfill`
- Stream/download: `GET /public/receipts/:receiptToken/file?objectKey=...`

## Smoke test (quick check)
```bash
API_BASE=http://127.0.0.1:4000
CONTENT_ID=<CONTENT_ID>

# Offer
curl -s "$API_BASE/p2p/content/$CONTENT_ID/offer" | jq
```

Verify:
- `sellerEndpoints[0].baseUrl` is your public origin
- `sellerEndpoints[1].baseUrl` is your LAN origin (optional)

## Notes
- Public origin is configured by `CONTENTBOX_PUBLIC_ORIGIN`.
- If public origin is missing, the app operates in **LAN-only mode**.
