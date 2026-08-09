# Certifyd Creator Dev Runbook

Use this when working locally across API + dashboard.

## Prerequisites

- Node.js 20+
- npm
- SQLite default runtime (bootstrap scripts handle schema sync)

## Boot locally

API:

```bash
cd apps/api
npm install
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
npm run dev
```

Dashboard:

```bash
cd apps/dashboard
npm install
npm run dev
```

## Environment basics

API env (`apps/api/.env`):

- `DATABASE_URL` (SQLite by default)
- `JWT_SECRET`
- Optional public host:
  - `CONTENTBOX_PUBLIC_ORIGIN`
  - fallback: `PUBLIC_ORIGIN`, `APP_PUBLIC_ORIGIN`

Dashboard env (`apps/dashboard/.env.local`):

- `VITE_API_BASE_URL=http://127.0.0.1:4000`
  - `VITE_API_URL` is also accepted

## Local node secret hardening

Before running a mainnet Lightning node, restrict local LND and Bitcoin credentials:

```bash
npm run security:harden-local-node
```

The script only touches known sensitive local files under `~/.lnd` and `~/.bitcoin`.

If you use the optional Docker services, copy `infra/.env.example` to `infra/.env`, replace every placeholder secret, and start them from `infra/`. Postgres and MinIO bind to `127.0.0.1` by default.

## Restricted LND macaroons

Contentbox normal commerce should not use `admin.macaroon`. Generate restricted macaroons on the node and upload them in Lightning settings:

```bash
lncli bakemacaroon \
  uri:/lnrpc.Lightning/AddInvoice \
  uri:/lnrpc.Lightning/LookupInvoice \
  uri:/lnrpc.Lightning/ListInvoices \
  --save_to ~/.lnd/data/chain/bitcoin/mainnet/certifyd-invoice.macaroon

lncli bakemacaroon \
  uri:/lnrpc.Lightning/GetInfo \
  uri:/lnrpc.Lightning/ListChannels \
  uri:/lnrpc.Lightning/PendingChannels \
  uri:/lnrpc.Lightning/WalletBalance \
  uri:/walletrpc.WalletKit/ListLeases \
  uri:/lnrpc.Lightning/DescribeGraph \
  uri:/lnrpc.Lightning/GetNodeInfo \
  --save_to ~/.lnd/data/chain/bitcoin/mainnet/certifyd-read.macaroon

lncli bakemacaroon \
  uri:/lnrpc.Lightning/DecodePayReq \
  uri:/lnrpc.Lightning/ListPayments \
  uri:/routerrpc.Router/SendPaymentV2 \
  --save_to ~/.lnd/data/chain/bitcoin/mainnet/certifyd-send.macaroon
```

Run `npm run security:harden-local-node` again after generating these files.

Legacy single-macaroon configuration is kept only for operator/migration use. If Lightning status reports `securityMigrationRequired`, upload the restricted invoice, read, and send credentials before using mainnet commerce.

## Public/private API boundary

The API process starts two HTTP surfaces:

- private creator/operator API: `PORT` / default `4000`
- public buyer/discovery API: `PUBLIC_PORT` / default `4010`

The private API binds to `127.0.0.1` by default. Do not point a public Cloudflare hostname at `:4000`. If a public hostname is accidentally routed to the private API, non-public routes fail closed with `404` unless `CONTENTBOX_ALLOW_PRIVATE_API_PUBLIC_HOST=1` is explicitly set. If remote dashboard access is required, put that hostname behind Cloudflare Access, VPN, or another private ingress control before exposing it.

The public API binds to `127.0.0.1` unless `CONTENTBOX_BIND=public` is set for direct public serving. Public Cloudflare tunnels should forward public creator hostnames to:

```text
http://127.0.0.1:4010
```

The public listener is fail-closed by `apps/api/src/security/publicRoutePolicy.ts`. Only routes explicitly listed in `PUBLIC_ROUTE_ALLOWLIST` are reachable from the public listener. A JWT or `Authorization` header does not make creator/operator routes reachable through this listener; authorization headers are stripped before public handlers run.

Route authority model:

| Classification | Examples | Public listener |
| --- | --- | --- |
| PUBLIC | public profile, buy pages, public content metadata, previews, buyer invoice creation, receipt polling, public discovery, public network presence, remote derivative ingress | allowed only by explicit allowlist |
| CREATOR AUTHENTICATED | creator library, uploads, publishing, profile management, splits, clearance, creator revenue, private buyer/creator data | private API only |
| OPERATOR / ADMIN | LND credential setup, channel/peer administration, node/tunnel config, diagnostics, backup/storage controls, privileged settlement controls | private API only; add Cloudflare Access/VPN if remote access is needed |

To add a new public endpoint:

1. classify the route as genuinely public buyer/discovery/commerce functionality
2. add it to `PUBLIC_ROUTE_ALLOWLIST` with a narrow method and path pattern
3. add/extend `test:public-boundary`
4. confirm no secrets, local addresses, liquidity, balances, invoices, payment hashes, filesystem paths, or private diagnostics are returned

## Mode model (must stay coherent)

- Basic Creator:
  - creator-hosted storefront via temporary tunnel
  - tips posture
- Sovereign Creator:
  - creator-hosted storefront via named tunnel
  - optional provider-backed commerce
- Sovereign Node:
  - creator-hosted storefront via named tunnel
  - verified local BTC/LND/invoice commerce stack

Do not treat provider connection as storefront authority.

## Verification commands

API smoke:

```bash
cd apps/api
npm test
npm run smoke:mode
```

Runtime smoke tests require the API on `http://127.0.0.1:4000`:

```bash
cd apps/api
npm run test:product-tier-gating
npm run test:storefront-gating
```

Dashboard build:

```bash
cd apps/dashboard
npm run build
```

## Common fixes

Prisma drift:

```bash
cd apps/api
npx prisma generate --schema prisma/schema.prisma
npx prisma db push --schema prisma/schema.prisma
```

If mode/commerce panels look stale after major routing changes:

1. restart API
2. hard refresh dashboard
3. recheck `/api/network/summary` and `/api/node/mode`

## Crash recovery

Use [docs/recovery.md](docs/recovery.md) for backup restore and account recovery-key flow.
