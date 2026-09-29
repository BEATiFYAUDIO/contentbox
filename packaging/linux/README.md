# Certifyd Core Linux Package

Extract the archive and run:

```sh
./start.sh
```

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
