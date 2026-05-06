# Certifyd Creator Quickstart

Authoritative first-run setup for technical beta testers.

## Prerequisites

- Git (manual install)
- Node.js 20+ (manual install, includes npm)

Installer scripts do not install Git or Node:

- `install.sh`
- `install.ps1`

Cloudflare Tunnel is optional and not required for local setup.

## Recommended install path

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

Open:

- Dashboard: `http://localhost:5173`
- API health: `http://localhost:4000/health`

`npm run dev` is acceptable, but `npm run dev:up` is preferred for beta.

## Manual fallback (secondary)

If the recommended install path fails, run API and dashboard directly.

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

- Node below 20:
  - install Node.js 20+ and retry
- Git not found:
  - install Git and restart terminal
- npm not found:
  - reinstall Node.js 20+ and restart terminal
- Windows PATH not refreshed:
  - close/reopen PowerShell, re-run `node -v` and `npm -v`
- Port `4000` or `5173` already in use:
  - stop old processes, then re-run `npm run dev:up`
- macOS/Linux install script permission issue:
  - `chmod +x ./install.sh` then `./install.sh`
- PowerShell execution policy issue:
  - run:
    - `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`
- Dashboard cannot reach API:
  - set `VITE_API_BASE_URL=http://localhost:4000` in `apps/dashboard/.env.local`

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

## Tester feedback

When reporting install issues, include:

- OS
- step number where you got stuck
- full error output
- what you expected to happen
