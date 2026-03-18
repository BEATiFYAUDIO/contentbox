# Dev Environment Alignment

Keep API target, mode posture, and public origin aligned.

## Local Studio

- Dashboard API: `http://127.0.0.1:4000`
- `apps/dashboard/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:4000
```

(`VITE_API_URL` is also accepted.)

## Public routing

Set canonical public origin on API:

```env
CONTENTBOX_PUBLIC_ORIGIN=https://certifyd.example.com
```

Fallbacks still accepted:

- `PUBLIC_ORIGIN`
- `APP_PUBLIC_ORIGIN`

## Mode/commerce alignment

- Basic: temporary tunnel + tips posture
- Sovereign Creator: named tunnel + optional provider commerce
- Sovereign Node: named tunnel + verified local commerce stack

Do not infer commerce enabled from named tunnel alone.
Do not infer storefront authority from provider connection.

## Quick validation

- `GET /api/node/mode`
- `GET /api/network/summary`
- `GET /api/diagnostics/status`
