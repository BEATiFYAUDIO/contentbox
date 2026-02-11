# PR2 — Split Lifecycle Enforcement

## Summary
Introduces a strict split lifecycle:
`draft → pending_acceptance → ready → locked`.

Key changes:
- Added new `SplitStatus` enum values: `pending_acceptance`, `ready`.
- Invites set split status to `pending_acceptance`.
- Accepting all invites moves status to `ready`.
- Locking/publish requires `ready` state.
- Added split lifecycle test script.

## Migration Notes
Run Prisma migrations to add new enum values:
```
apps/api/prisma/migrations/2026021101_split_status_lifecycle/migration.sql
```

## How To Test (Local)
1. Run the API.
2. Run the lifecycle test:
```
tsx apps/api/src/scripts/split_lifecycle_test.ts
```
3. Verify:
   - Invites flip split status to `pending_acceptance`.
   - Accepting all invites flips to `ready`.
   - Publish fails unless split is `ready`.
