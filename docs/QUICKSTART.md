# Certifyd Creator Quickstart

Authoritative first-run setup.

## Prerequisites

- Node.js 20+
- npm
- `curl`

Optional for Sovereign Node:

- local bitcoind
- local LND REST (`tls.cert`, `admin.macaroon`)

## Install and run

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

Open:

- API health: `http://127.0.0.1:4000/health`
- Dashboard: `http://127.0.0.1:5173`

## Three-mode progression

1. Basic Creator
2. Sovereign Creator
3. Sovereign Node

### Basic Creator

- temporary tunnel is valid
- publish, preview, tips
- no durable paid-commerce posture

### Sovereign Creator

- named/stable tunnel required
- storefront remains creator-hosted
- provider connection is optional and adds commerce services only

### Sovereign Node

- named/stable tunnel required
- local BTC + local LND + local invoice readiness required

## Product rules to keep in mind

- Creators host storefronts.
- Nodes provide commerce services.
- Provider connection does not make the provider the storefront host.

## Troubleshooting

If dashboard cannot reach API:

- set `VITE_API_BASE_URL=http://127.0.0.1:4000` in `apps/dashboard/.env.local`

If Prisma client/schema drift appears:

```bash
cd apps/api
npx prisma generate --schema prisma/schema.prisma
npx prisma db push --schema prisma/schema.prisma
```

If mode/commerce posture looks inconsistent:

1. restart API
2. hard refresh dashboard
3. verify:
   - `/api/node/mode`
   - `/api/network/summary`
