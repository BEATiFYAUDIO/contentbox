Certifyd Core for macOS

Drag Certifyd Core.app to Applications, then open it.

The app includes its own Node runtime, API dependencies, Prisma client and
engines, and prebuilt dashboard. Users do not need Git, system Node.js, npm
install, Prisma commands, or dashboard build commands.

Persistent user data is stored outside the app bundle:

~/Library/Application Support/ContentBox

Removing the app does not remove user data.

Optional integrations such as cloudflared, FFmpeg, LND, BTCPay, Bitcoin RPC,
and LAN/firewall configuration remain external and optional.
