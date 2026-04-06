# Public Origin and Buy-Link Authority

`CONTENTBOX_PUBLIC_ORIGIN` defines canonical public origin for generated public links.

Accepted fallback vars:

- `PUBLIC_ORIGIN`
- `APP_PUBLIC_ORIGIN`

## Example

```env
CONTENTBOX_PUBLIC_ORIGIN=https://certifyd.example.com
```

## Rules

- Use stable public origin for canonical links.
- Temporary tunnels are valid for preview/storefront transport in Basic mode.
- Temporary tunnels must not be treated as durable commerce authority.
- Storefront authority and commerce authority are separate concepts.

## Debug headers

Public surfaces include:

- `X-ContentBox-Origin` – resolved canonical origin
- `X-ContentBox-Node` – node identifier

These are informational and safe for routing diagnostics.

## Troubleshooting: Tunnel Hostname Mismatch

### Symptom

Diagnostics may show a mismatch such as:

- Public origin: `https://inklinguy.pro`
- Health probe: `https://certifyd-m4.inklinguy.pro`

This usually appears as degraded/fetch-failed public ping even when the tunnel is connected.

### Root Cause

Legacy diagnostics logic rewrote probe hostnames using `tunnelName + domain` instead of probing the configured canonical public origin.

### Expected Behavior

- Canonical public origin (explicit `publicOrigin`) always wins.
- Health probes must target `${canonicalOrigin}/api/health`.
- Tunnel name is transport metadata only and must not rewrite canonical host identity.

### Verify

In diagnostics, these should align:

- Public origin: `https://certifyd2.inklinguy.pro`
- Health probe: `https://certifyd2.inklinguy.pro`
- Public ping: `ok` (HTTP 200)
