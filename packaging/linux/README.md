# Certifyd Core Linux Package

Extract the archive and run:

```sh
./start.sh
```

For a Raspberry Pi, mini-PC, or other dedicated Core machine administered from
another device on the same LAN, run:

```sh
./start.sh --lan
```

LAN mode binds the private dashboard/API to the local network, records the
detected LAN address in the private host allowlist, and prints the dashboard URL.

The package includes its own Node runtime, API dependencies, generated Prisma
client, Prisma engines, and prebuilt dashboard. Users do not need Git, system
Node.js, npm install, Prisma commands, or dashboard build commands.

Persistent user data lives outside the extracted application folder:

- `$CONTENTBOX_ROOT` if set
- otherwise `$XDG_DATA_HOME/contentbox`
- otherwise `$HOME/.local/share/contentbox`

`start.sh` creates `contentbox.db` only when it is missing, then runs the
existing Prisma setup. Existing databases and user data are not overwritten.

Optional integrations such as cloudflared, FFmpeg, LND, BTCPay, Bitcoin RPC,
and LAN/firewall configuration remain external and optional.

Optional desktop integration:

```sh
./install-desktop.sh
```

This installs both normal local and LAN access launchers:

- `Certifyd Core`
- `Certifyd Core (LAN Access)`
