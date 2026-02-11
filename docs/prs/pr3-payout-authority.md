# PR3 — Payout Authority + Withdraw API

## Summary
Implements token-based payout authority for collaborators and a Lightning Address withdraw flow.

Key changes:
- New `PayoutAuthority` model (token hash, split scope, collaborator).
- `Payout` gains `idempotencyKey`.
- Token endpoints:
  - `GET /payout/v1/:token`
  - `POST /payout/v1/:token/withdraw`
- LNURL-Pay resolution + LND payment (with `DEV_ALLOW_SIMULATE_PAYOUTS=1` for tests).
- Split lock/publish now issues payout authority tokens.

## Migration Notes
Run Prisma migrations:
```
apps/api/prisma/migrations/2026021102_payout_authority/migration.sql
```

## How To Test (Local)
1. Start API.
2. Run the payout authority test:
```
DEV_ALLOW_SIMULATE_PAYOUTS=1 tsx apps/api/src/scripts/payout_authority_test.ts
```
3. Expected:
   - Withdrawals succeed with idempotency.
   - Royalties marked paid.
