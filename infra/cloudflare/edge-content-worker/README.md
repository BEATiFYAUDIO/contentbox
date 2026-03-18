# Certifyd Edge Content Worker

Optional Cloudflare Worker for edge byte delivery.

This worker validates short-lived edge tickets and proxies to origin `/content/:manifestHash/:fileId` with correct range behavior.

## Deploy

```bash
npx wrangler login
cp wrangler.toml.example wrangler.toml
npx wrangler secret put EDGE_TICKET_SECRET
npx wrangler deploy
```

## Configure

Set in `wrangler.toml`:

- `ORIGIN_BASE_URL`
- route for `/edge/content/*`

## Safety

- Do not route `/content/*` through worker.
- Keep worker path isolated to `/edge/content/*`.
