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
npm run smoke:basic
npm run smoke:advanced
```

Storefront gating test:

```bash
cd apps/api
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
