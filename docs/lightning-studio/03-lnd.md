# LND (Lightning)

LND connects to Bitcoin Core via RPC + ZMQ. Everything stays on localhost.

## Variables

```bash
export BITCOIN_DATADIR=/mnt/bitcoin/bitcoin
export LND_DIR=/home/<USER>/.lnd
export RPC_USER=<RPC_USER>
export RPC_PASS=<RPC_PASS>
```

## Install LND

Install LND using your preferred verified method. Confirm:

```bash
lnd --version
lncli --version
```

## Configure LND

Create or edit `$LND_DIR/lnd.conf`:

```ini
# lnd.conf
[Application Options]
listen=127.0.0.1:9735
rpclisten=127.0.0.1:10009
restlisten=127.0.0.1:8080
alias=<YOUR_NODE_ALIAS>

[Bitcoin]
bitcoin.active=1
bitcoin.mainnet=1
bitcoin.node=bitcoind

[Bitcoind]
bitcoind.rpcuser=<RPC_USER>
bitcoind.rpcpass=<RPC_PASS>
bitcoind.rpchost=127.0.0.1:8332
bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332
bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333
```

## Start LND (manually first)

Start Bitcoin Core first (see previous step), then run:

```bash
lnd --lnddir="$LND_DIR" --configfile="$LND_DIR/lnd.conf"
```

In another terminal, create or unlock the wallet:

```bash
lncli --lnddir="$LND_DIR" create
# or, if already created
lncli --lnddir="$LND_DIR" unlock
```

Verify LND status:

```bash
lncli --lnddir="$LND_DIR" getinfo
```

If you see `RPC server starting up`, wait 10-30 seconds and try again. This is normal immediately after unlock.

## Verify Ports

```bash
ss -lntp | egrep ':10009|:8080|:9735'
```

Expected:
- `10009` (gRPC) on `127.0.0.1`
- `8080` (REST) on `127.0.0.1`
- `9735` (P2P) on `127.0.0.1`

Stop LND (for now):

```bash
pkill lnd
```
