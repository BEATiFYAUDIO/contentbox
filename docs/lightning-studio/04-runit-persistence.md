# Runit Persistence

We use runit to keep Bitcoin Core and LND running across reboots.

## Variables

```bash
export BITCOIN_DATADIR=/mnt/bitcoin/bitcoin
export LND_DIR=/home/<USER>/.lnd
```

## Create Runit Service Directories

```bash
sudo mkdir -p /etc/service/bitcoind/log
sudo mkdir -p /etc/service/lnd/log
sudo mkdir -p /var/log/bitcoind /var/log/lnd
sudo chown -R <USER>:<USER> /var/log/bitcoind /var/log/lnd
```

## bitcoind run script

Create `/etc/service/bitcoind/run`:

```bash
sudo tee /etc/service/bitcoind/run >/dev/null <<'SH'
#!/bin/sh
exec 2>&1
umask 077
exec chpst -u <USER>:<USER> /usr/local/bin/bitcoind -conf=/mnt/bitcoin/bitcoin/bitcoin.conf -datadir=/mnt/bitcoin/bitcoin
SH
sudo chmod +x /etc/service/bitcoind/run
```

## lnd run script

Create `/etc/service/lnd/run`:

```bash
sudo tee /etc/service/lnd/run >/dev/null <<'SH'
#!/bin/sh
exec 2>&1
umask 077
exec chpst -u <USER>:<USER> /usr/local/bin/lnd --lnddir=/home/<USER>/.lnd --configfile=/home/<USER>/.lnd/lnd.conf
SH
sudo chmod +x /etc/service/lnd/run
```

## log scripts (svlogd)

Create `/etc/service/bitcoind/log/run`:

```bash
sudo tee /etc/service/bitcoind/log/run >/dev/null <<'SH'
#!/bin/sh
exec svlogd -tt /var/log/bitcoind
SH
sudo chmod +x /etc/service/bitcoind/log/run
```

Create `/etc/service/lnd/log/run`:

```bash
sudo tee /etc/service/lnd/log/run >/dev/null <<'SH'
#!/bin/sh
exec svlogd -tt /var/log/lnd
SH
sudo chmod +x /etc/service/lnd/log/run
```

## Hand Over Ownership from Cron (Important)

If cron or watchdogs are still starting Bitcoin or LND, **they must be disabled** to avoid duplicate processes. Comment out only those lines; keep any unrelated cron entries (like cloudflared).

Example cron lines to disable:

- `@reboot /usr/local/bin/bitcoind ...`
- `@reboot sleep 60 && /usr/local/bin/lnd ...`
- `*/1 * * * * bitcoind-watchdog.sh`
- `*/1 * * * * lnd-watchdog.sh`
- `*/30 * * * * lnd-bitcoin-logrotate.sh`

Then stop any old processes and start via runit:

```bash
bitcoin-cli -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR" stop || true
sleep 3
pkill bitcoind || true
pkill lnd || true

sv up bitcoind
sv up lnd
```

## Verify Runit Supervision

```bash
sv status bitcoind
sv status lnd
pgrep -a 'bitcoind|lnd' || true
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080' || true
```

If `sv status` says "access denied", run with `sudo` (depends on permissions on `/etc/service/*/supervise`).
