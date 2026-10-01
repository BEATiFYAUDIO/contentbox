# Certifyd Core

Certifyd Core is a local-first creator infrastructure application. It gives a creator a local dashboard for identity, works, release records, commerce setup, receipts, proofs, and publishing workflows while keeping persistent state under the creator's control.

Core is a local web application/runtime, not a desktop shell. Packaged builds include the API runtime, dashboard, Prisma runtime/client, platform-specific engines, and a bundled Node runtime.

## Download

Public beta installers are published on the Certifyd downloads page:

- https://certifyd.me/downloads/

The current public package set supports:

- Windows x64
- Linux x64
- Linux ARM64 / Raspberry Pi 64-bit
- macOS Apple Silicon
- macOS Intel

Packaged users should not need Git, system Node.js, npm, or manual Prisma commands.

## Launch

After installing or extracting the package, launch Certifyd Core from the platform entry point:

- Windows: Start Menu or Desktop shortcut `Certifyd Core`
- Linux: `./start.sh`, or run `./install-desktop.sh` to install desktop launchers
- macOS: open `Certifyd Core.app`

The private/operator dashboard runs on:

- `http://127.0.0.1:4000`

The separate public/tunnel listener uses:

- `http://127.0.0.1:4010`

Those are intentionally different surfaces.

## LAN Appliance Mode

For a Raspberry Pi, mini-PC, or other dedicated Core machine administered from a phone or laptop on the same network, use the LAN Access launcher:

- Windows: `Certifyd Core (LAN Access)`
- Linux: `./start.sh --lan` or desktop launcher `Certifyd Core (LAN Access)`
- macOS: `Start Certifyd Core with LAN Access.command`

LAN mode enables local-network administration of the private dashboard on `:4000` by setting `CONTENTBOX_PRIVATE_BIND=public` and adding detected LAN addresses to `CONTENTBOX_PRIVATE_ALLOWED_HOSTS`.

LAN mode does not set `CONTENTBOX_BIND=public` and does not broaden the separate public/tunnel listener on `:4010`.

If LAN access fails, check the Core machine's firewall for TCP port `4000`.

## Persistent Data

Packaged builds store user data outside the replaceable application folder. Normal upgrades must preserve existing:

- `DB_MODE`
- `CONTENTBOX_ROOT`
- `DATABASE_URL`
- SQLite database
- identity and signing keys
- catalog, media, commerce, and Cloudflare state

Uninstalling an application package should remove application/runtime files, not user data.

## Source / Developer Install

Source install is for developers and technical operators who want to run from the repository.

- Quickstart: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- Developer runbook: [README_DEV.md](README_DEV.md)
- Testing notes: [docs/TESTING.md](docs/TESTING.md)

Source installs require Git, Node.js 20+, npm, and local dependency installation.

## Public Links and Cloudflare

Cloudflare/public exposure is optional and separate from LAN administration.

- LAN appliance mode is for trusted devices on the same local network and uses the private listener on `:4000`.
- Public/tunnel exposure uses the separate listener on `:4010` and the public route allowlist.

Do not point a public hostname directly at `:4000` unless it is protected by an appropriate private ingress control such as Cloudflare Access or VPN.

More detail:

- Public/private boundary: [README_DEV.md](README_DEV.md#publicprivate-api-boundary)
- Public origin rules: [docs/public-origin.md](docs/public-origin.md)

## Release Notes

Public installers live in GitHub Releases:

- https://github.com/BEATiFYAUDIO/contentbox/releases

Release process and asset naming convention:

- [docs/RELEASING.md](docs/RELEASING.md)

GitHub Actions artifacts are temporary build/test outputs. GitHub Releases are the public installer archive.
