# Mode and Routing Smoke Tests

Use these checks after mode/routing/commerce changes.

## 1) API mode smoke

Runs without a live API and validates default Basic/SQLite mode resolution plus Advanced/LAN mode mapping.

```bash
cd apps/api
npm run smoke:mode
```

`npm run smoke:basic` is kept as a compatibility alias for `smoke:mode`.

## 2) Runtime product-tier smoke

Requires the API to be running on `http://127.0.0.1:4000`. This test is safe for the default SQLite install and skips checks that are not available in the active mode.

```bash
cd apps/api
npm run test:product-tier-gating
```

## 3) Storefront gating smoke

Requires the API to be running. The script supports the default SQLite install and optional Postgres workflows.

```bash
cd apps/api
npm run test:storefront-gating
```

## 4) Dashboard compile smoke

```bash
cd apps/dashboard
npm run build
```

## 5) Manual posture verification

Check these endpoints for coherent state:

- `GET /api/node/mode`
- `GET /api/network/summary`

Expected pattern:

- Named tunnel only, no provider, no local sovereign readiness:
  - participation: Sovereign Creator
  - commerce authority: Basic tips posture
- Named tunnel + provider connected:
  - participation: Sovereign Creator (Provider Commerce)
- Named tunnel + local BTC/LND/invoice ready:
  - participation: Sovereign Node
