# Mode Gating Smoke Tests

Use these smoke tests to verify Basic vs Advanced tier API enforcement.

## Recommended code state

Run on the branch/commit that includes:
- strict `FEATURE_LOCKED` guards for lightning/revenue/finance endpoints
- settlement writes skipped in Basic tier
- fixed capability reason mapping

## Commands

From repo root:

```bash
cd apps/api
npm run smoke:basic
npm run smoke:advanced
```

## What each test verifies

`smoke:basic`
- boots API in Basic tier on SQLite
- verifies `/api/identity` reports `productTier=basic`
- verifies these endpoints return `403` + `FEATURE_LOCKED`:
  - `/api/admin/lightning/readiness`
  - `/api/revenue/sales`
  - `/finance/overview`

`smoke:advanced`
- boots API in Advanced tier on SQLite (no LND configured)
- verifies `/api/identity` reports `productTier=advanced`
- verifies the same endpoints are **not** feature-locked
  - lightning endpoint may return not-configured/not-ready payloads
  - revenue/finance endpoints may return empty data

## Notes

- Tests are self-contained and create temporary SQLite data roots.
- They require `npx`, `tsx`, and a reachable DB configured in `apps/api/.env` or shell env.
