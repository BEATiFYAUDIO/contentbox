# Certifyd Edge Content Worker

Optional Cloudflare Worker for edge byte delivery.

This worker validates short-lived edge tickets and proxies to origin `/content/:manifestHash/:fileId` with correct range behavior.

Ticket validation must require:

- `mh` matches the requested manifest hash.
- `fid` matches the requested route file identifier.
- `ok` matches the exact resolved object key returned by the origin manifest.
- `exp` has not expired.
- `sid` is present for paid/protected full delivery when the origin issued a session-bound ticket.

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
- Do not proxy a request until the edge ticket has been validated.
- Forward Range requests only after validation succeeds.
