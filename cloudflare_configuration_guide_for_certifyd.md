# Cloudflare Tunnel Configuration Guide for Certifyd

## Overview

This guide documents the current Cloudflare Tunnel setup for the Debian-based Certifyd node and provides a clean, repeatable configuration pattern.

This setup is designed for:
- Debian/Linux without `systemd`
- `cloudflared` installed manually at `/usr/local/bin/cloudflared`
- a token-based Cloudflare Tunnel
- local Certifyd service listening on `127.0.0.1:4000`
- persistence handled by `cron` plus a watchdog script

## Current Architecture

```text
Internet
  ↓
Cloudflare Edge
  ↓
Cloudflare Tunnel (cloudflared)
  ↓
127.0.0.1:4000
  ↓
Certifyd API / app
```

The tunnel publishes public hostnames through Cloudflare and forwards traffic to the local Certifyd service.

## Why Token Mode Was Chosen

This machine previously had a mixed setup involving:
- `config.yml`
- a named tunnel UUID
- `credentials-file`
- `token-file`
- stale local tunnel artifacts

That mixed state caused:
- `HTTP 530`
- no active Cloudflare connection
- old tunnel confusion
- invalid JSON credential errors
- competing foreground/background runs

The current setup uses **token mode only** to keep the node simple and durable.

### Rules for this machine

Use:
- one Cloudflare tunnel token
- one launcher script
- one watchdog script
- one cron entry for startup
- one cron entry for recovery

Avoid:
- mixing `token-file` and `credentials-file`
- mixing old `config.yml` with token mode
- running multiple tunnel methods at once
- manually leaving a foreground tunnel tied to a terminal

## Installed Binary

The active `cloudflared` binary is:

```bash
/usr/local/bin/cloudflared
```

Check it with:

```bash
which cloudflared
cloudflared --version
```

Expected example:

```bash
/usr/local/bin/cloudflared
cloudflared version 2026.3.0
```

## Local Cloudflare State

The local Cloudflare state directory is:

```bash
~/.cloudflared
```

After cleanup, only minimal files are expected there, such as:
- `cert.pem`
- optional backups

Since the node is now token-based, it does **not** require:
- `~/.cloudflared/config.yml`
- tunnel JSON credentials
- token files on disk

## Public Hostnames

The Cloudflare side should route the desired public hostnames to the active tunnel.

Examples used during this setup included:
- `certifyd.darrylhillock.com`
- `buy.darrylhillock.com`
- `studio.darrylhillock.com`
- `contentbox.darrylhillock.com`

The local tunnel process forwards traffic to:

```bash
http://127.0.0.1:4000
```

## Manual Tunnel Command

The direct token-based command is:

```bash
cloudflared tunnel run --token <YOUR_REAL_TUNNEL_TOKEN>
```

This is useful for:
- first-time validation
- troubleshooting
- direct testing in the foreground

When this works properly, logs usually show successful connection registration, such as:

```text
Registered tunnel connection
location=yyz01
protocol=quic
```

## Important Warning About Foreground Runs

If you start the tunnel manually like this:

```bash
cloudflared tunnel run --token <TOKEN>
```

it runs in the foreground and is attached to the terminal.

If you close that terminal, the tunnel stops.

That is why persistent operation is handled with a detached launcher script and cron, not with an open shell.

## Persistent Startup Pattern

Because this Debian machine does not use `systemd`, persistence is handled through:

- a run script
- a watchdog script
- user crontab entries

### Run script path

```bash
/home/Darryl/.local/bin/cloudflared-contentbox-run.sh
```

The filename still contains `contentbox`, but that is cosmetic. The script can be renamed later. What matters is the command inside it.

### Recommended run script

```bash
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="$HOME/cloudflared.log"

if pgrep -x cloudflared >/dev/null 2>&1; then
  exit 0
fi

nohup /usr/local/bin/cloudflared tunnel run --token <YOUR_REAL_TUNNEL_TOKEN> >> "$LOG_FILE" 2>&1 &
disown || true
```

### Why this works

- `nohup` detaches the process from the terminal
- `&` backgrounds it
- `disown` prevents the shell from holding onto it
- `pgrep` avoids launching duplicate tunnel processes

## Watchdog Script

### Watchdog path

```bash
/home/Darryl/.local/bin/cloudflared-contentbox-watchdog.sh
```

### Recommended watchdog script

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! pgrep -x cloudflared >/dev/null 2>&1; then
  /home/Darryl/.local/bin/cloudflared-contentbox-run.sh
fi
```

### Purpose

This script checks whether the Cloudflare tunnel process is running. If not, it starts it again.

## Cron Configuration

Edit with:

```bash
crontab -e
```

Recommended entries:

```cron
@reboot /home/Darryl/.local/bin/cloudflared-contentbox-run.sh
*/1 * * * * /home/Darryl/.local/bin/cloudflared-contentbox-watchdog.sh
```

### What this does

- `@reboot` starts the tunnel automatically after machine boot
- `*/1 * * * *` checks every minute and restarts the tunnel if it dies

## File Permissions

Make sure both scripts are executable:

```bash
chmod +x /home/Darryl/.local/bin/cloudflared-contentbox-run.sh
chmod +x /home/Darryl/.local/bin/cloudflared-contentbox-watchdog.sh
```

## Health Checks

### Check local process

```bash
ps aux | grep cloudflared
```

Expected pattern:

```text
/usr/local/bin/cloudflared tunnel run --token ...
```

### Check Cloudflare sees the tunnel

```bash
cloudflared tunnel list
```

Expected result:
- active tunnel listed
- one or more active connections

### Check local Certifyd service

```bash
curl http://127.0.0.1:4000/api/health
```

Expected result:
- healthy response from Certifyd

### Check public hostname

```bash
curl -I https://certifyd.darrylhillock.com/api/health
```

Expected result:

```text
HTTP/2 200
```

## Known Warnings Seen During Setup

### ICMP proxy warning

Example:

```text
Group ID 1000 is not between ping group 1 to 0
ICMP proxy feature is disabled
```

This warning is not fatal for the HTTP tunnel. It only affects optional ICMP proxy behavior.

### UDP receive buffer warning

Example:

```text
failed to sufficiently increase receive buffer size
```

This warning is usually not fatal either. The tunnel can still connect successfully over QUIC.

If needed later, Linux buffer tuning can be adjusted, but this is optional as long as the tunnel is healthy.

## Cleanup Notes From This Migration

During migration, the following were intentionally removed because they were part of the old broken state:
- stale `config.yml`
- stale `.json` credential file
- stale `.token` file
- mixed credential/token tunnel launch logic
- root-owned competing cloudflared process

This cleaned the setup down to a single, reliable launch method.

## Deleting Old Tunnels

An old tunnel could not be deleted immediately because Cloudflare reported private network routes still attached:

```text
This tunnel has private network routes. Please remove all routes before deleting the tunnel.
```

That is a Cloudflare-side cleanup issue, not a local machine issue.

To fully remove an old tunnel:
1. remove its private routes in Cloudflare Zero Trust or via CLI
2. delete the old tunnel object
3. keep only the new active tunnel

## Recommended Operating Practice

For this machine, use the following workflow:

### Start or recover
```bash
/home/Darryl/.local/bin/cloudflared-contentbox-run.sh
```

### Inspect process
```bash
ps aux | grep cloudflared
```

### Inspect logs
```bash
tail -n 100 ~/cloudflared.log
```

### Check public health
```bash
curl -I https://certifyd.darrylhillock.com/api/health
```

## Best Practices Going Forward

- Keep only one active tunnel method on this node
- Do not mix token mode with config-based named tunnel mode
- Do not launch a second manual foreground tunnel when cron/watchdog is already managing one
- Keep the token only in the run script or another deliberate secret location
- Rotate or replace the token if it is exposed
- Rename the scripts from `contentbox` to `certifyd` later if desired, but only after updating cron entries
- Test reboot persistence after any major change

## Recommended Future Cleanup

These are optional cleanup items once the node is stable:

1. Rename:
   - `cloudflared-contentbox-run.sh` → `cloudflared-certifyd-run.sh`
   - `cloudflared-contentbox-watchdog.sh` → `cloudflared-certifyd-watchdog.sh`

2. Update crontab accordingly

3. Move logs from old ContentBox paths to Certifyd-specific paths if desired

4. Remove old `.bak` files once they are no longer needed

## Quick Recovery Checklist

If the public Certifyd URL goes down:

```bash
ps aux | grep cloudflared
curl http://127.0.0.1:4000/api/health
curl -I https://certifyd.darrylhillock.com/api/health
tail -n 100 ~/cloudflared.log
/home/Darryl/.local/bin/cloudflared-contentbox-run.sh
```

## Final State Summary

This Debian node is now configured to:
- run `cloudflared` from `/usr/local/bin/cloudflared`
- publish Certifyd through a Cloudflare Tunnel
- forward traffic to `127.0.0.1:4000`
- survive terminal closure
- restart on reboot
- recover automatically if the tunnel process dies

That gives Certifyd a stable public entry point without requiring `systemd`.
