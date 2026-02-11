# Troubleshooting

This section lists the real issues we encountered and how to fix them.

## 1) LND won’t start: `bind: address already in use` on 127.0.0.1:10009

Cause: a stray `lnd` process (often started by cron/watchdog or a previous manual run) is still running.

Fix:

```bash
pgrep -a lnd || true
pkill lnd || true
ss -lntp | egrep ':10009|:8080' || echo "ports free"

# Start via runit
sv up lnd
sv status lnd
```

If `sv status` shows access denied, run with `sudo`.

## 2) `lncli getinfo` says `RPC server starting up`

This is normal right after wallet unlock. Wait 10-30 seconds and run:

```bash
lncli --lnddir="$LND_DIR" getinfo
```

## 3) Cron vs runit ownership conflicts

If cron/watchdogs are still running Bitcoin/LND, runit can’t own the daemons. Symptoms include duplicate processes or `sv` reporting a service down while a daemon is running.

Fix:

1) Disable only the Bitcoin/LND cron entries (keep any unrelated cron, like cloudflared).
2) Stop the cron-launched daemons.
3) Start with runit.

Commands:

```bash
# Stop cleanly
bitcoin-cli -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR" stop || true
sleep 3
pkill bitcoind || true
pkill lnd || true

# Start via runit
sv up bitcoind
sv up lnd

# Verify
sv status bitcoind
sv status lnd
pgrep -a 'bitcoind|lnd' || true
```

## 4) LND can’t connect to bitcoind

Check Bitcoin Core is fully running and ZMQ is listening:

```bash
ss -lntp | egrep ':8332|:28332|:28333'
bitcoin-cli -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR" getblockcount
```

Verify LND config has correct RPC and ZMQ values in `lnd.conf`.

## 5) Ports are open on 0.0.0.0 (not local-only)

You must lock services to localhost. Check configs and restart.

Verify:

```bash
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080|:3000'
```

Expected: all bound to `127.0.0.1`.
