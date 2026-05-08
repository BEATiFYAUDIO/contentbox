# Upgrading Existing Local SQLite Nodes

This guide is for long-lived local Certifyd Creator installs that use SQLite and may predate Prisma migration history tracking.

## Safe default flow

From repo root:

```bash
git pull
cd apps/api
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
```

Then restart services:

```bash
cd ../..
npm run dev:down
npm run dev:up
```

## What `P3005` means

`P3005: The database schema is not empty` usually means:

- your SQLite database already has real tables/data
- but Prisma migration history was never baselined for that database

This **does not automatically mean data is broken**. It is common on legacy local installs.

## Additive schema fallback (non-destructive)

If `migrate deploy` fails with `P3005` for an additive nullable column, apply the column manually and continue.

### Current known additive column

```sql
ALTER TABLE ContentItem ADD COLUMN primaryTopic TEXT;
```

After applying:

```bash
cd apps/api
npx prisma generate --schema prisma/schema.prisma
```

Then restart API/dev stack.

## When `migrate deploy` is safe

`migrate deploy` is safe when Prisma migration history for the target DB is aligned/baselined.

If not aligned, prefer additive/manual SQL for narrow metadata columns rather than destructive reset flows.

## What not to do on production/local operator data

- Do **not** run destructive resets
- Do **not** wipe SQLite files
- Do **not** rewrite payout/split/accounting tables as part of schema catch-up

## Optional helper scripts

Use helper scripts from repo root:

- Linux/macOS: `./scripts/upgrade-local-sqlite.sh`
- Windows PowerShell: `./scripts/upgrade-local-sqlite.ps1`

These scripts:

- run `prisma generate`
- attempt `prisma migrate deploy`
- if `P3005` is detected, print exact non-destructive next steps

They do not reset databases.

