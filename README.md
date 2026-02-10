# Contentbox — Local-first sharing & invites

This README explains how to run Contentbox locally, create invites, and accept them across machines on a LAN. It covers a quick Docker-based setup and a developer flow (run API + dashboard from source). It also explains the stronger P2P acceptance flow where invitees run their own node and cryptographically sign acceptance.

Contents
- Overview
- Quick (Docker) start
- Developer/local start (owner)
- Developer/local start (invitee)
- Create invites (owner)
- Accept invites (invitee)
- P2P / signed acceptance
- Proofs (split lock) and proof.json
- Payments V1 (Lightning credits + receipts + spend)
- Derivatives (remix/mashup) + settlement
- .env examples
- Troubleshooting
- Next steps and recommended installer approach

---

## Overview

Contentbox is a local-first content sharing system. Owners create content and "split" definitions (who gets what share). The owner can generate invite links for participants. Invite links are secret tokens shown once at creation; the server stores only a hash of the token for security.

There are two acceptance modes:
- Quick accept: invitee opens the owner's invite URL in a browser and clicks Accept. This works without the invitee running a local node.
- P2P signed accept: the invitee runs their own Contentbox node, signs an acceptance payload locally, and sends the signed payload to the owner API. The owner verifies the signature by fetching the invitee node's public key and records cryptographic proof.

P2P sharing:
- Publish content to generate a manifest hash.
- Use the Share panel to copy a LAN P2P link (same Wi-Fi) or a Remote P2P link (DDNS / tunnel).

## Docs index
See `docs/README.md` for payments docs (LND setup, buy links, splits roadmap).


## Quick (Docker) start — recommended for testing on both Linux & Windows (via Docker Desktop)

This will start Postgres and MinIO used by Contentbox. It does not yet start the API/dashboard in containers (the repo contains dev scripts). Use the Docker services as a shared backend and run API + dashboard from source.

From the repo root:

```bash
cd infra
docker compose up -d
```

Verify containers:

```bash
docker compose ps
```

This starts Postgres on `localhost:5432` and MinIO on `localhost:9000`.


## Developer/local start (owner)

These steps run the API and dashboard from source on the owner machine. We'll assume:
- Owner machine LAN IP: `192.168.1.10` (replace with your actual IP)
- API port: `4000`
- Dashboard (Vite) port: `5173`

1) Create API .env at `apps/api/.env` (see example below).

2) Install dependencies and prepare Prisma (run once):

```bash
cd /home/Darryl/Projects/contentbox/apps/api
npm install
npm run prisma:generate
# apply migrations (dev)
npx prisma migrate dev --name init
```

3) Start the API (dev mode):

```bash
npm run dev
```

By default the API listens on 127.0.0.1:4000 only. To expose it on all interfaces for LAN testing:

```bash
CONTENTBOX_BIND=public npm run dev
```

4) Start the dashboard and point it to the owner API (so invite pages and accept calls work):

```bash
cd /home/Darryl/Projects/contentbox/apps/dashboard
# local dev (API on loopback)
VITE_API_URL="http://127.0.0.1:4000" npm run dev -- --host 0.0.0.0 --port 5173
```

Open the owner dashboard in a browser at `http://192.168.1.10:5173`.


## Developer/local start (invitee)

For the quick accept flow the invitee does NOT need to run their own node — they simply open the invite URL served by the owner and accept. To test the stronger P2P signed flow, the invitee should run their own local API + dashboard as well.

Invitee API `/apps/api` .env should set `APP_BASE_URL` to the invitee dashboard origin (e.g., `http://192.168.1.20:5173`). The invitee dashboard must be started with `VITE_API_URL` pointing at the owner API (so the invite page sends the signed acceptance to the owner API):

```bash
cd /path/to/contentbox/apps/dashboard
# replace 192.168.1.10 with owner API host
VITE_API_URL="http://192.168.1.10:4000" npm run dev -- --host 0.0.0.0 --port 5173
```

On Windows PowerShell:

```powershell
cd C:\path\to\contentbox\apps\dashboard
$env:VITE_API_URL = "http://192.168.1.10:4000"
npm run dev -- --host 0.0.0.0 --port 5173
```


## Create invites (owner)

1. Sign up and log in to the owner dashboard.
2. Create a content item (Content Library).
3. Open the Splits page for that content, set participants and percentages (total must equal 100).
4. Click **Create invites**. The Splits UI will create Invitation rows and immediately show the invite URLs (one-time token value) under **Created invites**.

Important: copy the invite URL immediately — the server stores only a hash, so the raw token is not recoverable later. You can still view pending invites under `Invite` => "Your outgoing invites" when signed in, but that view does not include token values.


## Accept invites (invitee) — quick flow

- Open the invite URL (example `http://192.168.1.10:5173/invite/<token>`) in your browser and click Accept. This posts to the owner API and marks the invitation accepted.

This quick option is the easiest for local testing and for collaborators who do not run their own node.


## P2P / signed acceptance (strong verification)

This is recommended if you want cryptographic proof of acceptance:

- Invitee runs their own Contentbox API + dashboard (as described above).
- The invitee signs acceptance locally via the endpoint `/local/sign-acceptance` (the dashboard does this automatically when you are signed in) and then submits the signed payload+signature to the owner API `/invites/:token/accept`.
- The owner verifies the signature by fetching `/.well-known/contentbox` from the invitee node to obtain its public key and records verification metadata in audit events.

Network notes:
- Invitee node must be reachable by the owner API at the `nodeUrl` the invitee includes in the signed payload (the dashboard sets `nodeUrl` to the invitee dashboard origin by default).

## Remote testing without port forwarding (Cloudflare Tunnel)

If you want to share a P2P link with someone on another network without changing router settings:

1) Install cloudflared
```bash
sudo apt install -y cloudflared
```

2) Start the tunnel (no systemd required)
```bash
cloudflared tunnel --url http://127.0.0.1:4000
```

3) Set CORS allowlist (so the remote origin can access the API)
```bash
# apps/api/.env
CONTENTBOX_PUBLIC_ORIGIN=https://<your-subdomain>.trycloudflare.com
```

4) Use the Share panel
- Publish the content
- Click **Copy Remote P2P Link** (host + port will be prefilled)

Keep the `cloudflared` process running while testing.

## Networking / Tunnel setup (token connector)

For the production-style, **tunnel-only** setup on MX Linux (no systemd, cron + watchdog, and stable public hostnames),
see:

`docs/networking/cloudflare-tunnel.md`

Diagnostics and buy-link troubleshooting:

`docs/networking/diagnostics.md`

## Using your own domain (recommended)

If you have a domain, you don’t need DDNS. Point a subdomain to your server’s public IP and use that hostname in the **Direct** host field.

Example:
- DNS A record: `contentbox.yourdomain.com` → your public IP
- Direct host field: `contentbox.yourdomain.com`

## Proofs (split lock) and proof.json

When a split version is **locked**, Contentbox generates a canonical `proof.json` and a stable `proofHash`. The proof anchors later payments and receipts.

What happens on lock:
- The API builds a canonical payload (stable key order, stable numeric strings) that excludes local-only fields.
- It writes `proofs/v{N}/proof.json` into the content repo and commits it.
- It returns `proofHash`, `manifestHash`, and `splitsHash`.

Proof fields include:
- `proofVersion`
- `contentId`
- `splitVersion` (e.g. "v1")
- `lockedAt` (ISO)
- `manifestHash`
- `primaryFileSha256`
- `splits` (participants)
- `creatorId`

Where proof lives in the repo:
```
<CONTENTBOX_ROOT>/<type>s/<repo>/
  proofs/v1/proof.json
```

UI surfacing:
- Splits page (locked version) shows proof hash / manifest hash / splits hash with copy actions.
- "View proof.json" opens a modal; "Export proof.json" downloads it.

API endpoints:
- Lock by version: `POST /content/:contentId/splits/:version/lock`
- Read proof: `GET /content/:contentId/splits/:version/proof`

## Payments V1 (Lightning credits + receipts + spend)

V1 payments are **credits-based** and anchored to a `proofHash`:
- Buyer purchases time units (30s each).
- Node verifies Lightning payment and issues a receipt.
- Playback spends units to keep access.

### Payment providers
Configured via env:
- `PAYMENT_PROVIDER=lnd|btcpay|none` (default: `lnd`)

LND (REST):
- `LND_REST_URL`
- `LND_MACAROON_HEX` (or path to macaroon file)
- `LND_TLS_CERT_PATH` (or PEM string)

BTCPay (optional):
- `BTCPAY_URL`
- `BTCPAY_API_KEY`
- `BTCPAY_STORE_ID`

If `PAYMENT_PROVIDER=none`, UI still renders but invoice creation fails with a clear message.

### Credit purchase flow
1. User locks a split and gets a `proofHash`.
2. User generates an invoice for `units` (30s per unit).
3. User pays BOLT11.
4. On paid, the node issues `receipts/<receiptId>.json` and commits it.

Receipt location in repo:
```
<CONTENTBOX_ROOT>/<type>s/<repo>/
  receipts/<receiptId>.json
```

## Payments V1 (content purchase unlocks manifest)

This flow is the simplest “get paid” for content downloads/streaming. It is **separate** from the credit system above.

Flow:
1. Client requests a payment intent for a specific `contentId` + `manifestSha256`.
2. API returns an on-chain BTC address (always) and an optional Lightning invoice (LNbits).
3. Client polls `refresh` until the intent becomes `paid`.
4. On paid, the API creates an `Entitlement(contentId, manifestSha256)` and runs settlement.
5. Client calls `/api/content/:id/access?manifestSha256=...` to retrieve manifest + file list.

Endpoints:
- `POST /api/payments/intents` → creates intent + returns on-chain address (and LN invoice if configured)
- `GET /api/payments/intents/:id` → status check
- `POST /api/payments/intents/:id/refresh` → checks payment, marks paid, finalizes purchase
- `GET /api/content/:id/access?manifestSha256=...` → entitlement gate

Lightning (optional, LNbits):
- `LNBITS_URL`
- `LNBITS_INVOICE_KEY`

On-chain (required):
- Prefer RPC wallet (bitcoind): `BITCOIND_RPC_URL`, `BITCOIND_RPC_USER`, `BITCOIND_RPC_PASS`, `BITCOIND_WALLET` (optional)
- Fallback XPUB: `ONCHAIN_RECEIVE_XPUB` (stores derivation index on the intent)

### Playback gating (credits spend)
The client calls `POST /v1/stream/spend` with a `receiptId` and `unitIndex`.
- If valid, a spend row is recorded and a short-lived `streamPermitToken` is returned.
- If out of credits or already spent, the request is rejected.

### Payments API (auth required)
- `GET /v1/payments/price?proofHash=...`
- `POST /v1/payments/quote` `{ proofHash, units }`
- `POST /v1/payments/invoice` `{ proofHash, units }`
- `GET /v1/payments/status/:purchaseId`
- `GET /v1/payments/receipt/:purchaseId`
- `POST /v1/stream/spend` `{ receiptId, unitIndex, sessionId? }`

### Minimal UI
On locked splits:
- "Buy playback credits" with units input
- Generate invoice
- Copy BOLT11
- Poll status until paid
- Show receiptId

## Derivatives (remix/mashup) + settlement

Derivative works are **new content records** with their own files, manifest, and split. Parents are linked via `ContentLink`.

Flow overview:
1) Create derivative (child):
   - `POST /api/content/:parentId/derivative`
   - Creates child content + repo + draft split.
2) Upload files to the child content (same upload endpoint).
3) Create manifest:
   - `POST /api/content/:contentId/manifest`
4) Publish:
   - `POST /api/content/:contentId/publish`
   - Validates split sum == 10000 and upstream sum <= 10000.

Upstream semantics (Option 1):
- Each parent link has `upstreamBps` which is a **direct** share of the child’s net revenue routed to that parent.
- Sum of upstreamBps across parents must be <= 10000.

2-stage settlement (when PaymentIntent is PAID):
- Stage 1: allocate upstream pools per parent (basis points of child net).
- Stage 2: allocate remaining sats by child split bps.
- Parent pools are distributed by each parent’s locked split.
All math is BigInt sats with deterministic rounding (leftover to largest bps).


## .env examples

Owner `apps/api/.env` (Linux example)

```
DATABASE_URL="postgres://contentbox:contentbox_dev_password@127.0.0.1:5432/contentbox"
JWT_SECRET="dev-secret-change-me"
CONTENTBOX_ROOT="/home/youruser/.contentbox"
APP_BASE_URL="http://192.168.1.10:5173"
PORT=4000
PAYMENT_PROVIDER="lnd"
RATE_SATS_PER_UNIT=100
LND_REST_URL="https://127.0.0.1:8080"
LND_MACAROON_HEX="..."
LND_TLS_CERT_PATH="/path/to/tls.cert"
```

Invitee `apps/api/.env` (Windows example)

```
DATABASE_URL="postgres://contentbox:contentbox_dev_password@127.0.0.1:5432/contentbox"
JWT_SECRET="dev-secret-invitee"
CONTENTBOX_ROOT="C:\\Users\\Invitee\\.contentbox"
APP_BASE_URL="http://192.168.1.20:5173"
PORT=4000
PAYMENT_PROVIDER="lnd"
RATE_SATS_PER_UNIT=100
LND_REST_URL="https://127.0.0.1:8080"
LND_MACAROON_HEX="..."
LND_TLS_CERT_PATH="C:\\path\\to\\tls.cert"
```


## Troubleshooting

- Invite page empty / no token shown:
  - Make sure the owner clicked **Create invites** and copied the invite URL immediately.
  - If you are the owner and you don't see created invite URLs, after clicking the button check the Splits page area labeled **Created invites**.
  - If you see a pending invite under **Invite** (outgoing invites) but no token, that is expected — tokens are intentionally not stored in recoverable form.

- `npx tsc` or other CLI errors in this environment:
  - Ensure dev dependencies are installed (`npm install`) and run `npm run dev` which uses `tsx` for the API and `vite` for the dashboard.

- Network connectivity:
  - When testing across machines ensure the API port (4000) and dashboard port (5173) are reachable across the LAN and not blocked by a firewall.
- Payments returning "Payments are disabled":
  - Ensure `PAYMENT_PROVIDER` is not `none` and LND/BTCPay env vars are set.
- Receipt not issued after paid:
  - Call `GET /v1/payments/receipt/:purchaseId` after status is `paid`. Receipt issuance is idempotent and happens on-demand.


## Next steps / Installer recommendation

For a simple cross-platform installer experience, I recommend using Docker Compose plus a tiny wrapper script that:
- Ensures Docker (or Docker Desktop) is present,
- Starts the infra stack (Postgres & MinIO),
- Optionally starts the API & dashboard in containers or instructs the user to run the dev commands.

If you'd like, I can:
- Add a `docker-compose` service for the API and dashboard for a single `docker compose up -d` dev environment.
- Add a short `install.sh` and `install.ps1` that automate Node/npm install + env creation + run steps for native installs.

Tell me which next step you'd like (Docker-run everything or native installer scripts), and I will implement it.

---

If you want a concise one-line checklist to pass to your collaborator for the fast path, here it is:

1. Owner: open Splits → Create invites → copy the invite URL.
2. Invitee: open the invite URL in browser → click Accept.

If you want the stronger P2P flow, reply and I will add scripts and a packaged Docker compose that runs API + dashboard containers so you can install the same image on both machines and test the signed acceptance flow.
