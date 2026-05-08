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

## Technical Beta Install (Recommended)

Certifyd runs locally by default.

Cloudflare Tunnel is optional and not required for local setup.

Before installing Certifyd, beta testers must install:

- Git
- Node.js 20+ (includes npm)

The installer scripts (`install.sh` / `install.ps1`) do not install Git or Node.

### Windows (PowerShell)

```powershell
git --version
node -v
npm -v
git clone https://github.com/BEATiFYAUDIO/contentbox.git
cd contentbox
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
npm run dev:up
start http://localhost:5173
```

### macOS / Linux

```bash
git --version
node -v
npm -v
git clone https://github.com/BEATiFYAUDIO/contentbox.git
cd contentbox
chmod +x ./install.sh
./install.sh
npm run dev:up
```

Then open:

- Dashboard: `http://localhost:5173`
- API health: `http://localhost:4000/health`

`npm run dev` is acceptable, but `npm run dev:up` is the preferred beta start command.

## Manual fallback (secondary)

If the recommended install path fails, run API and dashboard manually.

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

- Dashboard: `http://localhost:5173`
- API health: `http://localhost:4000/health`

## Tester feedback

When reporting install issues, include:

- OS
- step number where you got stuck
- full error output
- what you expected to happen

## Troubleshooting

- Node below 20:
  - install Node.js 20+ and re-run install
- Git not found:
  - install Git and restart terminal
- npm not found:
  - reinstall Node.js 20+ and restart terminal
- Windows PATH not refreshed:
  - close/reopen PowerShell, re-run `node -v` and `npm -v`
- Port `4000` or `5173` already in use:
  - stop previous local processes, then run `npm run dev:up` again
- macOS/Linux script permission issue:
  - run `chmod +x ./install.sh` then `./install.sh`
- PowerShell execution policy blocked:
  - run with:
    - `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`

## Canonical docs

- Setup: `docs/QUICKSTART.md`
- Local SQLite upgrades (legacy nodes): `docs/UPGRADING_LOCAL_NODE.md`
- Mode and routing env alignment: `docs/dev-env-alignment.md`
- Public origin rules: `docs/public-origin.md`
- Smoke testing: `docs/TESTING.md`, `docs/qa-smoke.md`
- Cloudflare tunnel ops: `cloudflare_configuration_guide_for_certifyd.md`

## Current direction

This repository is actively evolving. If behavior and docs diverge, treat API/runtime truth as canonical and update docs in the same change set.
