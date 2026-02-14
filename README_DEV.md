# ContentBox P2P Dev Runbook

## Requirements
- Node.js + npm (no root package.json; installs are per app)
- Postgres (local or remote)

## Fresh Clone Quickstart (API)
```bash
git clone <repo>
cd contentbox
git checkout fix/northstar-mvp-hardening

cd apps/api
bash scripts/bootstrap-dev.sh
# then edit apps/api/.env and re-run if prompted
```

## Dashboard Quickstart
```bash
cd apps/dashboard
bash scripts/bootstrap-dev.sh
```

## One-command install
macOS/Linux:
```bash
./install.sh
```
Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
After the first run, edit:
- `apps/api/.env` (DATABASE_URL)
- `apps/dashboard/.env` if your API is not localhost

## LTE quick demo (10 lines)
```bash
# 1) install
./install.sh
# 2) edit apps/api/.env (DATABASE_URL)
# 3) start services
cd apps/api && npm run dev
cd ../dashboard && npm run dev
# 4) optional: LAN/tunnel (if using public links)
CONTENTBOX_BIND=public
# 5) upload content, publish, copy buy link, test on LTE
```

## LAN sharing
By default the API binds to loopback only. For LAN access:
```bash
CONTENTBOX_BIND=public
```
If LAN access fails, allow tcp/4000 in your firewall (e.g., UFW on Linux).

## Public Link (Basic)
- Default `PUBLIC_MODE` is `quick` (if unset, quick tunnel is used).
- Public Link starts a managed quick tunnel when you publish or click “Enable Public Link”.
- First time on a device, you must approve the helper tool download before Public Link starts.
- If `cloudflared` is not found, the API will download a managed binary into `CONTENTBOX_ROOT/.bin` automatically.
- Public server listens on `PUBLIC_PORT` (default `4010`) and is the only listener exposed via the tunnel.
- The public URL is transient and only works while ContentBox is running. The link may change after a restart.
- Only buyer/public routes are exposed on the public origin (`/public/ping`, `/p/:token`, `/buy/*`).
- Optional: set `CLOUDFLARED_VERSION` to pin the exact cloudflared release used by managed download.
Tip: the installer can optionally pre-download the helper tool (with consent) and enable auto-start for quick tunnels.

Check capabilities:
```bash
curl http://127.0.0.1:4000/api/capabilities
```

## Common errors and fixes
- **Prisma config fails / DATABASE_URL missing**: set `DATABASE_URL` in `apps/api/.env`
- **JWT_SECRET missing**: the installer auto-generates it; re-run install if missing
- **CONTENTBOX_ROOT missing**: installer auto-creates it under `~/contentbox-data`
- **@prisma/client errors**: run `npx prisma generate` from `apps/api`

## Environment flags
- `DEV_P2P_UNLOCK=1` to allow stream permits without payment
- `PAYMENT_PROVIDER=none` to bypass payment rails
- `PREVIEW_ENABLED=1` (default) to allow preview clamp on priced content
- `PREVIEW_MAX_BYTES=5000000` (default)

## LND Lightning (LND REST)
Required env vars (server-side only):
```
LND_REST_URL=https://127.0.0.1:8080
LND_MACAROON_HEX=...
LND_TLS_CERT_PATH=/path/to/tls.cert
```
Optional:
```
LND_TLS_CERT_PEM="-----BEGIN CERTIFICATE-----..."
```

Quick start (one command):
```bash
cd apps/api
npm run lnd:setup
npm run lnd:doctor
```

If you run the API via systemd/docker/pm2, set env there. The scripts will pick up process.env.
If you prefer file-based env, create `apps/api/.env.local` with the LND_* values.

Common LND file locations:
- TLS cert: `~/.lnd/tls.cert`
- Invoice macaroon:
  - `~/.lnd/data/chain/bitcoin/mainnet/invoices.macaroon`
  - `~/.lnd/data/chain/bitcoin/testnet/invoices.macaroon`
  - `~/.lnd/data/chain/bitcoin/regtest/invoices.macaroon`

Validation scripts (safe, no secrets printed):
```bash
cd apps/api
npm run lnd:validate
npm run lnd:doctor
```

## Payments (LND) Quickstart
```bash
cd apps/api
# set these in apps/api/.env.local (do NOT commit)
CONTENTBOX_PUBLIC_ORIGIN=https://buy.<your-domain>
PUBLIC_INVITE_ORIGIN=https://invites.<your-domain>
LND_REST_URL=https://127.0.0.1:8080
LND_TLS_CERT_PATH=/home/<user>/.lnd/tls.cert
LND_MACAROON_HEX=<hex>

# restart API and verify public origin
npm run api:restart-health
curl -s http://127.0.0.1:4000/health
```

Verify offer returns public first:
```bash
API_BASE=http://127.0.0.1:4000
CONTENT_ID=<contentId>
curl -s "$API_BASE/p2p/content/$CONTENT_ID/offer" | jq
```

Invite links:
- `PUBLIC_INVITE_ORIGIN` sets a neutral shared host for all invite links (recommended for scale).
- Buy links still use the content owner’s per-user public origin.

Remote test:
- Open buy link on LTE/5G, pay from phone wallet, verify settlement.

Docs:
- docs/payments/lnd-setup.md
- docs/payments/buy-links-and-endpoints.md
- docs/payments/splits-roadmap.md

## End-to-end smoke test (buy flow)
```bash
cd apps/api
CONTENT_ID=<contentId> npm run smoke:buy
```
Optional auto-pay (requires lncli + funded wallet):
```bash
AUTO_PAY=true CONTENT_ID=<contentId> npm run smoke:buy
```
Notes:
- For public (unauth) flow, the content must be **published** and storefront enabled.
- To test as the owner, pass a token:
  `AUTH_TOKEN=<jwt> CONTENT_ID=<contentId> npm run smoke:buy`
  - Mint a dev token (prints to stdout):
    `npm run auth:mint-dev-token`

## LAN test (two machines)
1) Start seller API on Machine A.
2) Ensure content is published and has price set.
3) Generate v1 link from Share panel.
4) On Machine B, paste link into Store page and open.

Note: API binds to loopback by default. For LAN testing, either set `CONTENTBOX_BIND=public` or use a tunnel for remote testing.

## Publish (draft -> published)
1) Open content card.
2) Click **Publish** in the header.
3) If blocked, fix listed reasons (e.g., add primary file, fix split).
4) After success, manifest hash + share links are active.

## Permit + stream curl examples
```bash
API_BASE=http://127.0.0.1:4000
MANIFEST=<manifestHash>
FILEID=<primaryFileId>

# Issue permit
curl -s -X POST "$API_BASE/p2p/permits" \
  -H "Content-Type: application/json" \
  -d "{\"manifestHash\":\"$MANIFEST\",\"fileId\":\"$FILEID\",\"buyerId\":\"you@example.com\",\"requestedScope\":\"preview\"}"

# Stream with permit
curl -I "$API_BASE/content/$MANIFEST/$FILEID?t=<permit>"
curl -H "Range: bytes=0-1048575" "$API_BASE/content/$MANIFEST/$FILEID?t=<permit>" -o /tmp/part.bin
```

## Expected status codes
- Free content: 200/206 without permit
- Priced + preview enabled: 200/206 (preview clamp) even without permit
- Priced + preview disabled:
  - No permit: 402 PAYMENT_REQUIRED
  - Invalid/expired permit: 403 FORBIDDEN
  - Valid stream permit: 200/206 full

## Quick test script
```bash
cd apps/api
npx tsx src/scripts/permit_range_test.ts http://127.0.0.1:4000 <manifestHash> <fileId>
```

## Tailscale (tailnet-only HTTPS sharing)
ContentBox binds to `127.0.0.1:4000` by default (`CONTENTBOX_BIND=local`), so it is not exposed on your LAN or the public internet.

To share with testers via Tailscale HTTPS:
```bash
cd apps/api
tailscale serve reset
tailscale serve https / http://127.0.0.1:4000
```

Access URL (for testers on your tailnet):
```
https://<your-device-name>.<your-tailnet>.ts.net
```

Optional env:
- `CONTENTBOX_PUBLIC_ORIGIN=https://<your-device-name>.<your-tailnet>.ts.net` (CORS allowlist)

## Cloudflare Tunnel (no systemd)
Quick always-on tunnel (restarts if it exits):
```bash
cd apps/api
npm run tunnel:start
```

Stop the tunnel:
```bash
cd apps/api
npm run tunnel:stop
```

Logs: `/tmp/cloudflared-tunnel.log`

When using Cloudflare Tunnel, ensure your tunnel ingress targets the public-only listener:
```
http://127.0.0.1:4010
```

Then set:
```
CONTENTBOX_PUBLIC_ORIGIN=https://<your-subdomain>.trycloudflare.com
```
Then restart the API so the Share panel can prefill the Remote host/port.

If you split public buy vs creator studio hosts, you can set:
```
CONTENTBOX_PUBLIC_BUY_ORIGIN=https://buy.<your-domain>
CONTENTBOX_PUBLIC_STUDIO_ORIGIN=https://studio.<your-domain>
```

## Using your own domain (preferred over DDNS)
If you already control a domain, point a subdomain to your public IP and use it in the **Direct** host field. This is more stable and professional than DDNS.

## Porkbun DDNS auto-update (optional)
If your public IP changes, use Porkbun's API to keep `contentbox.<your-domain>` updated.

1) Create a local config file (do not commit keys):
```bash
mkdir -p ~/.contentbox
cat > ~/.contentbox/porkbun-ddns.env <<'EOF'
PB_API_KEY=YOUR_PORKBUN_KEY
PB_API_SECRET=YOUR_PORKBUN_SECRET
PB_DOMAIN=darrylhillock.com
PB_HOST=contentbox
PB_TTL=600
EOF
```

2) Run the updater:
```bash
cd apps/api
npm run ddns:porkbun
```

3) (Optional) Cron every 10 minutes:
```bash
(crontab -l 2>/dev/null; echo "*/10 * * * * /home/Darryl/Projects/contentbox/apps/api/scripts/porkbun-ddns.sh >/tmp/porkbun-ddns.log 2>&1") | crontab -
```

## Shipping & security notes (important)
- DDNS is **optional and opt-in**. Do not enable by default in distributed builds.
- API keys must live in user-owned files (e.g. `~/.contentbox/porkbun-ddns.env`) and must never be committed.
- If a GUI helper is added, it should only **generate** local config and **run on demand**, not auto-run silently.
- Exposing port 4000 publicly is for testing only. Production should use a reverse proxy + TLS + auth.

## Cloudflare Tunnel (systemd)
Install service (for packaged builds):
```bash
sudo cp /home/Darryl/Projects/contentbox/apps/api/scripts/cloudflared-tunnel.service /etc/systemd/system/contentbox-cloudflared.service
sudo systemctl daemon-reload
sudo systemctl enable --now contentbox-cloudflared.service
```
