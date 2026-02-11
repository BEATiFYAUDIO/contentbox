# Lightning Studio — Operations Notes

## Revenue dashboard troubleshooting

If the Revenue dashboard shows empty data or rail health warnings:

1) Check runit service logs

- LND: `/var/log/lnd/current`
- bitcoind: `/var/log/bitcoind/current`

2) Verify services are running

```bash
sv status lnd
sv status bitcoind
ss -lntp | egrep ':8080|:10009|:8332|:28332|:28333'
```

3) Common Lightning rail issues

- **Wallet locked**
  - Unlock: `lncli unlock`
- **Signature mismatch after caveat verification**
  - Wrong macaroon. Use the macaroon for this LND instance.
  - Prefer `invoice.macaroon` for receive-only.
- **TLS errors**
  - Ensure `LND_TLS_CERT_PATH` points to the correct `tls.cert`.
  - If REST is HTTP on localhost, set `LND_REST_URL` to `http://127.0.0.1:8080`.

4) Revenue endpoints return empty (but should be 200)

If the API returns empty arrays and zeros, run:

```bash
cd apps/api
npm run prisma:generate
```

This ensures Prisma client includes the finance models.

5) Check API health

```bash
curl -s http://127.0.0.1:4000/health
```

If still failing, review API logs and restart the service.
