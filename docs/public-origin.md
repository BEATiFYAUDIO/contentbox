# PUBLIC_ORIGIN (Canonical Buy Link Origin)

Use this when the public entry point is a Cloudflare tunnel or any external hostname.

## Example (Cloudflare named tunnel)
```
PUBLIC_ORIGIN=https://buy.example.com
```

Notes:
- `PUBLIC_ORIGIN` is preferred; `APP_PUBLIC_ORIGIN` is accepted as a fallback.
- When set, buy links and snippets will use this origin.
- Public buy links remain public; this only changes which base URL is generated.

## Debug Headers
Public surfaces include two safe, informational headers:
- `X-ContentBox-Origin`: resolved canonical origin for the request.
- `X-ContentBox-Node`: node identifier (`NODE_ID` or hostname).
These are safe for public exposure and help debug Cloudflare tunnel + multi-machine setups.
