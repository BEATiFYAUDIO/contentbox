# LND REST Setup (Headless) for ContentBox

This is a minimal, headless LND REST setup for ContentBox. No GUI is required. ThunderHub is optional.

## Required env vars (server-side only)
**Do not commit these.** Put them in `apps/api/.env.local`.

Example (do not paste real values):
```
LND_REST_URL=https://127.0.0.1:8080
LND_TLS_CERT_PATH=/home/<user>/.lnd/tls.cert
LND_MACAROON_HEX=<hex>
```

Optional:
```
LND_TLS_CERT_PEM="-----BEGIN CERTIFICATE-----..."
```

## Common file locations
- TLS cert: `~/.lnd/tls.cert`
- Invoice macaroon:
  - `~/.lnd/data/chain/bitcoin/mainnet/invoices.macaroon`
  - `~/.lnd/data/chain/bitcoin/testnet/invoices.macaroon`
  - `~/.lnd/data/chain/bitcoin/regtest/invoices.macaroon`

## Convert macaroon to hex (example)
```bash
xxd -p -c 9999 ~/.lnd/data/chain/bitcoin/mainnet/invoices.macaroon
```

## Validation scripts
From `apps/api`:
```bash
npm run lnd:setup
npm run lnd:doctor
npm run lnd:validate
```

Notes:
- `getinfo` may return **permission denied** for invoice-only macaroons. That’s expected; invoice create/lookup is what matters.
- LND invoice lookup uses **hex** `r_hash` in the URL path. Base64 fallback is supported but hex is preferred.

## Common errors
- **Missing env**: `.env.local` not loaded. Ensure scripts are run from `apps/api` or set env in process.
- **FST_ERR_CTP_EMPTY_JSON_BODY**: Fastify rejects empty JSON body when `Content-Type: application/json` is set. Fix by sending `{}` or removing the header for empty POSTs.
- **Invoice lookup 404**: Ensure lookup uses **hex** `r_hash` in the URL path.

## Security notes
- Never log macaroons or full invoices.
- All LND calls are server-side only.
