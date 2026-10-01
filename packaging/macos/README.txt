Certifyd Core for macOS

Drag Certifyd Core.app to Applications, then open it.

For a dedicated LAN machine administered from another device on the same local
network, the launcher supports --lan. LAN mode binds the private dashboard/API
to the local network, records the detected LAN address in the private host
allowlist, and opens the LAN dashboard URL.

The app includes its own Node runtime, API dependencies, Prisma client and
engines, and prebuilt dashboard. Users do not need Git, system Node.js, npm
install, Prisma commands, or dashboard build commands.

Persistent user data is stored outside the app bundle:

~/Library/Application Support/ContentBox

Removing the app does not remove user data.

Optional integrations such as cloudflared, FFmpeg, LND, BTCPay, Bitcoin RPC,
and LAN/firewall configuration remain external and optional.
