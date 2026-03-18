# Cloudflare Tunnel Guide for Certifyd

This guide documents the supported tunnel control modes and how Certifyd should behave.

## Control modes

Certifyd must distinguish these two modes clearly:

1. `existing_named` (preferred for regular users)
   - named tunnel already exists in Cloudflare
   - service-managed connector may run via token (`cloudflared tunnel run --token ...`)
   - hostname routing is managed in Cloudflare UI

2. `token_bootstrap` (first-time setup only)
   - used to bootstrap tunnel connector where no matching named tunnel is detected

Do not mix both modes in one active setup flow.

## Operational truth

If host service runs `cloudflared tunnel run --token ...`, local `~/.cloudflared/config.yml` is not the runtime source of truth for ingress mapping.

In that case:

- treat service token run as active control path
- treat Cloudflare dashboard hostnames as authoritative for public routing
- do not present local ingress config as if it is active

## Expected DNS/Tunnel pattern

Examples:

- `certifyd.<domain>` → named tunnel `Certifyd`
- `buy.<domain>` → named tunnel `Certifyd`
- optional creator hostnames/subdomains → same tunnel

Local target remains API/public listener configured for Certifyd runtime.

## Certifyd UI expectations

Tunnel status block should surface:

- provider
- tunnel name
- tunnel detected
- tunnel online
- active tunnel mode
- public base domain

If named tunnel is detected:

- token bootstrap controls should be disabled/hidden
- show note: existing named tunnel detected; bootstrap not required

## Persistence and reboot

Tunnel/provider posture should recover after reboot from persisted config + runtime verification refresh.

No silent no-op actions:

- refresh/start/stop/enable/disable actions must return visible success/error state.
