# Security Model

This setup is designed for small studios and non-engineers. The goal is **safe-by-default**:

- **No services are exposed publicly**.
- Everything binds to `127.0.0.1`.
- Access to GUI tools happens via **SSH tunnel**.
- **No secrets are committed** to git.

## Localhost Only

These ports should listen only on `127.0.0.1`:

- Bitcoin RPC: `8332`
- Bitcoin ZMQ: `28332`, `28333`
- LND gRPC: `10009`
- LND REST: `8080`
- ThunderHub: `3000`

Verify with:

```bash
ss -lntp | egrep ':8332|:28332|:28333|:10009|:8080|:3000'
```

## Secrets

Never commit these:

- RPC username/password
- LND TLS certificate
- LND macaroons
- ThunderHub passwords

Use placeholders in docs and config templates:

- `<RPC_USER>`
- `<RPC_PASS>`
- `<LND_ADMIN_MACAROON_PATH>`
- `<LND_TLS_CERT_PATH>`

## Wallet Unlock

LND wallet unlock requires a human (or an external signer). **Do not** use plaintext auto-unlock. The unlock is done manually after reboot:

```bash
lncli --lnddir="$LND_DIR" unlock
```

If you see `RPC server starting up`, wait and retry `lncli getinfo`.
