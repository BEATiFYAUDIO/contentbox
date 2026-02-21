# Dev Environment Alignment

## Local Mode
- Dashboard points to local API: `http://127.0.0.1:4000`
- Local Postgres only

## LAN Mode
- Dashboard points to LAN API (e.g. `http://192.168.100.109:4000`)
- Postgres on that LAN machine only

## Tunnel Mode (Cloudflare)
- Dashboard still points to local API (e.g. `http://127.0.0.1:4000`)
- Public links should use the tunnel hostname via `PUBLIC_ORIGIN`
```
PUBLIC_ORIGIN=https://buy.example.com
```

## Set Dashboard API URL
Create or edit `apps/dashboard/.env.local`:
```
VITE_API_URL=http://127.0.0.1:4000
```

## Enable Whoami Safely
In `apps/api/.env` (or `.env.local`):
```
WHOAMI_ENABLED=1
WHOAMI_ALLOW_REMOTE=1
```
Set `WHOAMI_ALLOW_REMOTE=1` only when you need LAN access to `__whoami`.
In production (`NODE_ENV=production`), `__whoami` is always disabled.

## Public Buy Links
No changes to any public buy link behavior or routes.
