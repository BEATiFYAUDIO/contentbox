# Mode and Routing Smoke Tests

Use these checks after mode/routing/commerce changes.

## 1) API tier smoke

```bash
cd apps/api
npm run smoke:basic
npm run smoke:advanced
```

## 2) Storefront gating smoke

```bash
cd apps/api
npm run test:storefront-gating
```

## 3) Dashboard compile smoke

```bash
cd apps/dashboard
npm run build
```

## 4) Manual posture verification

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
