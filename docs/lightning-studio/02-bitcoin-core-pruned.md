# Bitcoin Core (Pruned)

We run Bitcoin Core **pruned** to reduce disk usage. This is fully compatible with LND.

## Variables

```bash
export BITCOIN_DATADIR=/mnt/bitcoin/bitcoin
export RPC_USER=<RPC_USER>
export RPC_PASS=<RPC_PASS>
```

## Install Bitcoin Core

Use the official package or your preferred verified install method. Once installed, confirm:

```bash
bitcoind --version
bitcoin-cli --version
```

## Configure Bitcoin Core

Create or edit `$BITCOIN_DATADIR/bitcoin.conf`:

```ini
# bitcoin.conf (pruned)
server=1
daemon=0
prune=5500

# RPC (local only)
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcuser=<RPC_USER>
rpcpassword=<RPC_PASS>

# ZMQ for LND (local only)
zmqpubrawblock=tcp://127.0.0.1:28332
zmqpubrawtx=tcp://127.0.0.1:28333

# Optional: reduce disk usage further
# dbcache=300
```

Notes:
- `daemon=0` is required for runit supervision.
- `prune=5500` keeps a ~5.5GB chain. Increase if you have more disk.

## Start Bitcoin Core (manually first)

```bash
bitcoind -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR"
```

Wait a few seconds, then verify:

```bash
ss -lntp | egrep ':8332|:28332|:28333'
bitcoin-cli -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR" getblockcount
```

Expected:
- RPC port `8332` is listening on `127.0.0.1`.
- ZMQ ports `28332` and `28333` are listening on `127.0.0.1`.
- `getblockcount` returns a number (it will increase as you sync).

Stop Bitcoin Core (for now):

```bash
bitcoin-cli -conf="$BITCOIN_DATADIR/bitcoin.conf" -datadir="$BITCOIN_DATADIR" stop
```
