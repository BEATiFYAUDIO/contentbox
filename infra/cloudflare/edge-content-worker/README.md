# Edge Content Worker

Optional Cloudflare Worker for ContentBox edge byte delivery.

This worker validates short-lived edge tickets and proxies to origin `/content/:manifestHash/:fileId` while preserving range behavior.

It is infra tooling only; not part of ContentBox runtime bootstrap.

## Quick deploy (no install)

Run from this folder:

```bash
npx wrangler login
cp wrangler.toml.example wrangler.toml
npx wrangler secret put EDGE_TICKET_SECRET
npx wrangler deploy
```

## Create `wrangler.toml` from example

```bash
cp wrangler.toml.example wrangler.toml
```

Then set:

- `ORIGIN_BASE_URL` in `wrangler.toml`
- route config (if using custom domain)

## Set secret

```bash
npx wrangler secret put EDGE_TICKET_SECRET
```

## Deploy

```bash
npx wrangler deploy
```

## Test bad token => 404

```bash
curl -i "https://<your-edge-host>/edge/content/<manifestHash>/<fileId>?t=badtoken"
```

## Test range => 206

After minting a valid ticket from ContentBox API:

```bash
curl -i "<edge_url>" -H "Range: bytes=0-1023"
```

Expected:

- `206 Partial Content`
- `Content-Range` present

## Bind route (custom domain)

Use a route that only matches edge path, for example:

- `contentbox.darrylhillock.com/edge/content/*`

Do not route `/content/*` through the worker, otherwise origin fetch can loop.
