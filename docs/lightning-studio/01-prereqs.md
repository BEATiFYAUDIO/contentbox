# Prerequisites

This guide assumes:

- Debian/Devuan-like host (no systemd).
- `runit` is available.
- You have shell access and can run commands as your user and (when needed) `sudo`.

## Variables (set these for your setup)

```bash
export BITCOIN_DATADIR=/mnt/bitcoin/bitcoin
export LND_DIR=/home/<USER>/.lnd
export RPC_USER=<RPC_USER>
export RPC_PASS=<RPC_PASS>
```

## Install Base Packages

```bash
sudo apt update
sudo apt install -y curl jq gnupg ca-certificates lsof
sudo apt install -y runit
```

Check runit is running:

```bash
ps aux | grep -E 'runsvdir|runsv ' | grep -v grep
```

Expected: `runsvdir -P /etc/service` is active.

## Create Data Directories

```bash
sudo mkdir -p "$BITCOIN_DATADIR"
mkdir -p "$LND_DIR"
```

## Verify Local Ports Are Free (before install)

```bash
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080|:3000' || echo "ports free"
```

If any are already in use, stop those processes before continuing.
