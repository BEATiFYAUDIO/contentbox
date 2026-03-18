# Edge Delivery (Optional)

Optional Cloudflare Worker path for byte-range delivery.

- Origin route remains authoritative.
- Edge route is an optional proxy layer.
- Payment/entitlement authority remains in Certifyd API.

## Flags

```env
EDGE_DELIVERY_ENABLED=false
EDGE_TICKET_SECRET=<strong-secret>
EDGE_BASE_URL=https://certifyd.example.com
EDGE_TICKET_TTL_SECONDS=60
```

When disabled:

- edge ticket endpoints are not active
- existing origin behavior remains unchanged

## Guardrails

- route worker only for `/edge/content/*`
- fetch origin `/content/*`
- avoid looped routing

## Quick smoke

Bad token should fail:

```bash
curl -i "https://<edge-host>/edge/content/<manifestHash>/<fileId>?t=bad"
```

Valid token + range should return `206` with `Content-Range`.
