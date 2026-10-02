# Certifyd Core Quickstart

This guide separates normal packaged installation from source/developer installation.

## Packaged Install

Use the public downloads page unless you are developing Core itself:

- https://certifyd.me/downloads/

Supported beta packages:

- Windows x64 installer
- Linux x64 archive
- Linux ARM64 / Raspberry Pi 64-bit archive
- macOS Apple Silicon DMG
- macOS Intel DMG

Packaged installs include the Core runtime, dashboard, Node runtime, production dependencies, Prisma client/engines, and database bootstrap. Users should not need Git, system Node.js, npm, or manual Prisma commands.

### Windows

1. Download the Windows x64 installer.
2. Run the installer.
3. Launch `Certifyd Core` from the Start Menu or Desktop.
4. Open `http://127.0.0.1:4000` if the browser does not open automatically.

For a dedicated LAN machine, use `Certifyd Core (LAN Access)`.

### Linux

```sh
tar -xzf Certifyd-Core-<version>-linux-x64.tar.gz
cd Certifyd-Core-<version>-linux-x64
./start.sh
```

For Linux ARM64 / Raspberry Pi 64-bit, use the ARM64 archive and matching extracted directory.

For a dedicated LAN machine:

```sh
./start.sh --lan
```

Optional desktop launchers:

```sh
./install-desktop.sh
```

This installs both `Certifyd Core` and `Certifyd Core (LAN Access)`.

### macOS

1. Download the DMG for Apple Silicon or Intel.
2. Open the DMG.
3. Drag `Certifyd Core.app` to Applications.
4. Open the app.

For a dedicated LAN machine, open `Start Certifyd Core with LAN Access.command` from the disk image.

Current beta macOS packages are unsigned and not notarized. macOS Gatekeeper may require Finder -> right-click -> Open.

## LAN Appliance Mode

LAN mode is for a trusted local network where Core runs on one machine and is administered from another device on the same LAN.

LAN mode:

- enables LAN access to the private/operator dashboard on `:4000`
- sets `CONTENTBOX_PRIVATE_BIND=public`
- preserves and extends `CONTENTBOX_PRIVATE_ALLOWED_HOSTS`
- sets `APP_BASE_URL` to the selected LAN address when detected
- does not set `CONTENTBOX_BIND=public`
- does not broaden the public/tunnel listener on `:4010`

If LAN access fails, allow TCP port `4000` through the Core machine's firewall.

## Public Cloudflare / Tunnel Exposure

Public sharing is separate from LAN administration.

- Private/operator dashboard: `:4000`
- Public/tunnel listener: `:4010`

Do not expose `:4000` publicly without a private ingress control such as Cloudflare Access or VPN. Public creator/fan routes should use the public listener and public route allowlist.

See:

- [public-origin.md](public-origin.md)
- [../README_DEV.md#publicprivate-api-boundary](../README_DEV.md#publicprivate-api-boundary)

## Source / Developer Install

Use this path only when running from the repository.

Prerequisites:

- Git
- Node.js 20+
- npm

### Windows PowerShell

```powershell
git --version
node -v
npm -v
git clone https://github.com/BEATiFYAUDIO/contentbox.git
cd contentbox
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
npm run dev:up
start http://localhost:4000
```

For LAN setup during source install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Lan
npm run dev:up
```

### macOS / Linux

```sh
git --version
node -v
npm -v
git clone https://github.com/BEATiFYAUDIO/contentbox.git
cd contentbox
chmod +x ./install.sh
./install.sh
npm run dev:up
```

For LAN setup during source install:

```sh
./install.sh --lan
npm run dev:up
```

Open:

- Core dashboard: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- Public listener health/routes: `http://127.0.0.1:4010` where applicable

## Manual Developer Fallback

If the source installer fails, run API and dashboard setup directly.

API:

```sh
cd apps/api
npm install
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
npm run dev
```

Dashboard:

```sh
cd apps/dashboard
npm install
npm run build
```

## Troubleshooting

- Node below 20:
  - install Node.js 20+ and retry
- Git not found during source install:
  - install Git and restart the terminal
- npm not found during source install:
  - reinstall Node.js 20+ and restart the terminal
- Windows PATH not refreshed:
  - close/reopen PowerShell, re-run `node -v` and `npm -v`
- Port `4000` already in use:
  - stop old processes, then re-run `npm run dev:up`
- PowerShell execution policy issue:
  - run with `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`
- Prisma client/schema drift during source development:
  - run `cd apps/api`
  - run `npx prisma generate --schema prisma/schema.prisma`
  - run `npx prisma db push --schema prisma/schema.prisma`

## Product Rules

- Creators host storefronts.
- Nodes provide commerce services.
- Provider connection does not make the provider the storefront host.
- LAN administration and public exposure are different operating modes.

## Reporting Install Issues

Include:

- operating system and architecture
- package filename or source commit
- step where you got stuck
- full error output
- what you expected to happen
