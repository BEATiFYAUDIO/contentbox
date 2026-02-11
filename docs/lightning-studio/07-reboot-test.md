# Reboot Test

This confirms your node survives a reboot with runit supervision.

## Before Reboot (Snapshot)

```bash
sv status bitcoind
sv status lnd
pgrep -a 'bitcoind|lnd'
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080'
```

## Reboot

```bash
sudo reboot
```

## After Reboot

1) Check runit supervision:

```bash
ps aux | grep -E 'runsvdir|runsv ' | grep -v grep
sv status bitcoind
sv status lnd
```

2) Check listeners:

```bash
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080'
```

3) Unlock LND wallet (manual):

```bash
lncli --lnddir="$LND_DIR" unlock
lncli --lnddir="$LND_DIR" getinfo | egrep 'synced_to_chain|synced_to_graph|block_height|num_peers'
```

## Success Criteria

- `bitcoind` and `lnd` show "up" in `sv status`.
- Ports are listening on `127.0.0.1` only.
- LND unlock works and `getinfo` returns synced fields.
