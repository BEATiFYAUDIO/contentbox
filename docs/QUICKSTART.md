# Certifyd Creator Quickstart

This is the authoritative first-run guide.
Quickstart uses a SQLite-first runtime and schema sync via `prisma db push`; legacy PostgreSQL migration history is not used for local quickstart installs.

## Install

### Prerequisites
- Git
- Node.js 20+ and npm
- `curl`

Optional for Sovereign Node mode:
- Existing LND node with REST enabled
- `tls.cert`
- `admin.macaroon`

### Download and install

Use a pinned release tag/commit, not `main`.

macOS/Linux:

```bash
git clone https://github.com/<org-or-user>/contentbox.git
cd contentbox
git checkout <PINNED_TAG_OR_COMMIT>
./install.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/<org-or-user>/contentbox.git
cd contentbox
git checkout <PINNED_TAG_OR_COMMIT>
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Windows users: run `install.ps1` (not `install.sh`).

## First Run (Basic)

Start API:

```bash
cd apps/api
npm run dev
```

Start dashboard:

```bash
cd apps/dashboard
npm run dev
```

Open:
- API health: `http://127.0.0.1:4000/health`
- Dashboard: `http://127.0.0.1:5173`

Basic mode is the default and works without PostgreSQL or LND.
Installers always bootstrap SQLite for first run.

## Upgrade to Advanced (Sovereign Node) (Optional)

Advanced mode upgrades services/readiness (LND, Public Link), not the core database provider.

1. Sign in.
2. Open **Profile**.
3. Switch **Node Mode** to **Advanced (Sovereign Node)**.
4. Check the **Advanced setup readiness** panel in Profile:
   - cloudflared: optional unless you need Public Link
   - LND: should become ready after config
5. Open Finance/Lightning setup and enter:
   - REST URL (usually `https://127.0.0.1:8080`)
   - `tls.cert`
   - `admin.macaroon`
6. Test and save.

Optional (power users, Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\api\upgrade-advanced.ps1
```

Optional (power users, from `apps/api`):

```bash
npm run upgrade:advanced
```

Important:
- Avoid setting `PRODUCT_TIER` or `NODE_MODE` in env unless you intentionally want to lock the Node Mode toggle.

## Troubleshooting

- If API does not start, verify:
  - `node -v`
  - `npm -v`
  - `apps/api/.env` exists
- If dashboard cannot connect, verify:
  - API is up on `127.0.0.1:4000`
  - `apps/dashboard/.env` has `VITE_API_BASE_URL=http://127.0.0.1:4000`
- If Advanced toggle is disabled, check lock reason shown in Profile (env lock).
- If Lightning setup fails, verify LND REST endpoint, cert, and macaroon files.
- If you see a Prisma datasource mismatch:
  - `cd apps/api`
  - `npx prisma generate --schema prisma/schema.prisma`
  - `npx prisma db push --schema prisma/schema.prisma`

## Diagnostics

Collect these when reporting setup/runtime issues:

```bash
git rev-parse --short HEAD
node -v
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4000/api/public/diagnostics | jq
```

Optional verification:

```bash
cd apps/api
npm run smoke:basic
npm run smoke:advanced
```
