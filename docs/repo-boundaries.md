# Repo Boundaries (Testing Readiness)

## ContentBox / Certifyd app repo (`contentbox`)

This repo is for the product runtime only:

- `apps/api` (API/runtime)
- `apps/dashboard` (dashboard UI)
- runtime/config/scripts/docs for local node operation

It intentionally excludes the marketing/promo site.

## Promo site repo (`certifyd-me-site`)

Promo/marketing static page files are separated to:

- `/home/Darryl/Projects/certifyd-me-site`

That repo should own:

- landing `index.html`
- `CNAME`
- promo screenshots/assets

## Tester baseline (before running QA)

1. Confirm branch:
   - `git rev-parse --abbrev-ref HEAD`
2. Confirm clean tree:
   - `git status --short`
3. Build checks:
   - `npm --prefix apps/api exec tsc -- -p apps/api/tsconfig.json --noEmit`
   - `npm --prefix apps/dashboard run build`
4. Health check:
   - `curl http://127.0.0.1:4000/health`

