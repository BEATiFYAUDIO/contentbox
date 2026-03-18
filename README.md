# Certifyd Creator

Certifyd Creator is a creator-hosted storefront and commerce system with a strict three-mode progression:

1. Basic Creator
2. Sovereign Creator
3. Sovereign Node

Core rule:

- Creators host storefronts.
- Nodes provide commerce services.

A connected provider can supply invoicing, receipts, and settlement for Sovereign Creator mode, but it must not become storefront authority.

## Architecture truth

- Storefront authority is creator-hosted by mode:
  - Basic: temporary tunnel
  - Sovereign Creator: named/stable tunnel
  - Sovereign Node: named/stable tunnel
- Commerce authority is separate from storefront authority:
  - Basic: tips / direct wallet posture
  - Sovereign Creator: provider-backed commerce optional
  - Sovereign Node: verified local BTC/LND/invoice stack

## Repo layout

- `apps/api` – Fastify API, routing, commerce, settlement, provider delegation
- `apps/dashboard` – React dashboard/studio
- `docs` – product, setup, routing, and testing docs

## Start locally

API:

```bash
cd apps/api
npm install
npm run dev
```

Dashboard:

```bash
cd apps/dashboard
npm install
npm run dev
```

Open:

- API: `http://127.0.0.1:4000/health`
- Dashboard: `http://127.0.0.1:5173`

## Canonical docs

- Setup: `docs/QUICKSTART.md`
- Mode and routing env alignment: `docs/dev-env-alignment.md`
- Public origin rules: `docs/public-origin.md`
- Smoke testing: `docs/TESTING.md`, `docs/qa-smoke.md`
- Cloudflare tunnel ops: `cloudflare_configuration_guide_for_certifyd.md`

## Current direction

This repository is actively evolving. If behavior and docs diverge, treat API/runtime truth as canonical and update docs in the same change set.
