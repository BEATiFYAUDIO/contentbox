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
