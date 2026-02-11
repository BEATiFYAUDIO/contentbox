# Lightning Studio Node: Overview

This guide helps a studio or musician run a local Lightning node on a Debian/Devuan-like host **without systemd**, using **runit** for persistence. The setup is intentionally conservative:

- **Bitcoin Core is PRUNED** (saves disk space).
- **LND** connects to Bitcoin Core via **RPC + ZMQ**.
- **ThunderHub GUI** is **localhost-only** and accessed via **SSH tunnel**.
- Everything binds to `127.0.0.1` (not exposed to the internet).
- **No secrets are committed**; all sensitive values are placeholders.

You will end up with a node that survives reboots and can receive Lightning payments once it has inbound liquidity.

## Files in This Guide

Read and follow these in order:

1. `docs/lightning-studio/01-prereqs.md`
2. `docs/lightning-studio/02-bitcoin-core-pruned.md`
3. `docs/lightning-studio/03-lnd.md`
4. `docs/lightning-studio/04-runit-persistence.md`
5. `docs/lightning-studio/05-thunderhub-gui.md`
6. `docs/lightning-studio/06-security-model.md`
7. `docs/lightning-studio/07-reboot-test.md`
8. `docs/lightning-studio/08-first-payment.md`
9. `docs/lightning-studio/09-troubleshooting.md`

## Variables Used Throughout

At the top of each file, you will see or assume these variables:

- `BITCOIN_DATADIR=/mnt/bitcoin/bitcoin`
- `LND_DIR=/home/<USER>/.lnd`
- `RPC_USER=<RPC_USER>`
- `RPC_PASS=<RPC_PASS>`

Replace `<USER>`, `<RPC_USER>`, and `<RPC_PASS>` with your own values.
