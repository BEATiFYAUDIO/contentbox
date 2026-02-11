# PR — North Star MVP Payment Flow

## Summary
Adds a PaymentRail abstraction and a safe confirm hook for payment intents, enabling:
- Lightning Address (LNURL‑Pay) intake for non‑technical musicians.
- LND rail compatibility for publisher/seller nodes.
- Idempotent payment confirmation via `/api/payments/intents/:id/confirm` (alias to refresh).

## Key Changes
- `PaymentRail` interface with `LightningAddressRail` + `LndRail`.
- `/p2p/payments/intents` and `/api/payments/intents` now use rail selection:
  - Lightning Address if configured for seller.
  - LND/LNbits otherwise.
- Confirm path updated to handle LNURL rail (dev simulation supported).
- Added `northstar_mvp_test.ts` script for the end‑to‑end flow.

## How To Test (Local)
1. Start API.
2. Run the test script:
```
DEV_ALLOW_SIMULATE_PAYMENTS=1 tsx apps/api/src/scripts/northstar_mvp_test.ts
```
3. Expected:
   - Content publish + split lock succeeds.
   - Payment intent created.
   - Simulated payment settles.
   - `/finance/royalties` shows 60/40 allocation.

## Notes
- LNURL payment confirmation is provider‑dependent. Current confirm returns unpaid unless:
  - `DEV_ALLOW_SIMULATE_PAYMENTS=1` (dev mode), or
  - A future webhook/poller is implemented.
