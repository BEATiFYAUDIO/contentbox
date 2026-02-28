# Edge Delivery (Optional Scale Layer)

ContentBox can optionally deliver paid content bytes through a Cloudflare Worker edge proxy.

This is a ticketed proxy for range streaming on top of the existing origin route:

- Origin route (unchanged): `/content/:manifestHash/:fileId`
- Edge route (optional): `/edge/content/:manifestHash/:fileId?t=<ticket>`

By default this is OFF and existing behavior is unchanged.

## Why this exists

- Keep entitlement/payment logic in ContentBox origin.
- Offload byte delivery to edge POPs for better stream responsiveness.
- Preserve origin `Range` semantics (`200/206/416`) via pass-through proxying.

## Feature flag behavior

API flags:

- `EDGE_DELIVERY_ENABLED=false` (default)
- `EDGE_TICKET_SECRET=<random strong secret>` (required when enabled)
- `EDGE_BASE_URL=https://contentbox.darrylhillock.com` (used for minted edge URLs)
- `EDGE_TICKET_TTL_SECONDS=60` (default)

When disabled:

- `/api/public/edge-ticket` returns `404`
- Buy page continues using origin `/content/...` URLs only.

## Worker config

Worker runtime values:

- Worker secret: `EDGE_TICKET_SECRET`
- Worker var: `ORIGIN_BASE_URL` (your ContentBox origin, no trailing slash)

Example `ORIGIN_BASE_URL`:

- `https://contentbox.darrylhillock.com`

## Deploy options

### 1) Quick workers.dev test

From `infra/cloudflare/edge-content-worker`:

```bash
npx wrangler login
cp wrangler.toml.example wrangler.toml
npx wrangler secret put EDGE_TICKET_SECRET
npx wrangler deploy
```

### 2) Custom route (recommended)

Use a zone route so only edge path is intercepted:

- Route pattern example: `contentbox.darrylhillock.com/edge/content/*`

Cloudflare route patterns must include the zone/domain portion (for example `example.com/path/*`).

## Pitfalls

- Avoid infinite loops:
  - Worker should only match `/edge/content/*`
  - Worker origin fetch should target `/content/*`
- Do not commit `wrangler.toml` (local account/route config). Keep only `wrangler.toml.example`.
- Keep `EDGE_DELIVERY_ENABLED=false` until Worker route + secret are configured.

## Smoke checks

### Bad token => 404

```bash
curl -i "https://contentbox.darrylhillock.com/edge/content/<manifestHash>/<fileId>?t=badtoken"
```

Expected: `404`.

### Valid token + range => 206

1. Mint ticket:

```bash
curl -sS -X POST "https://contentbox.darrylhillock.com/api/public/edge-ticket" \
  -H "Content-Type: application/json" \
  -d '{"manifestHash":"<manifestHash>","fileId":"<fileId>","receiptToken":"<receiptToken>"}'
```

2. Request byte range:

```bash
curl -i "<edge_url_from_step_1>" -H "Range: bytes=0-1023"
```

Expected: `206` with `Content-Range` header present.
