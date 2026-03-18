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
