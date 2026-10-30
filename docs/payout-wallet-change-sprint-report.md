# Sprint report: payout wallet changes

**Status:** Local safety fix complete; release and end-to-end verification remain for the next sprint.

## Problem

Two test Lightning wallets were replaced. The new addresses were saved in Core profile integrations and Network Provider, but the provider still displayed an older wallet on a payment record. Provider payment intents retain the payout address captured when each intent was created; changing a current wallet does not rewrite historical records. A provider handshake does not synchronize payout destinations.

## Audit findings

- The local provider has 146 payment intents, all in participant payout mode. None was created after October 26, 2026, so the local records do not establish what happened in the user's later test.
- One remote participant's public payout endpoint resolves a verified Lightning address. Another currently returns no payout destination. Payouts for the latter may remain pending until a current destination is available.
- In the participant payout path, a failed lookup for a locked split participant could fall back to an address cached in the delegated payment blueprint. That address may be obsolete after a wallet change.
- The separate legacy creator-remittance retry path also uses the address stored on its intent. The local provider currently has no legacy intents awaiting remittance, but this path should be reviewed before legacy retries are used elsewhere.

## Change already made locally

`apps/api/src/server.ts` now leaves a locked split payout pending when its current participant destination cannot be resolved. It no longer uses the cached blueprint address for that case. This change is in source only; the running Core installation and deployed nodes have not received it.

Validation: API TypeScript check passed; all 12 payout-status tests passed. These tests do not exercise a wallet-change end-to-end scenario.

## Next-sprint work

1. Add an end-to-end regression test: create an intent with wallet A, change the participant wallet to B, then settle or retry and verify it can only pay B or remain pending. Cover unavailable public destination and a restart.
2. Investigate why the second participant's public payout endpoint has no destination. Confirm the address and verification state on that participant's own Core node.
3. Review the legacy remittance retry path and make it fail safely when the current destination cannot be confirmed or differs from the intent snapshot.
4. Rebuild and release the Core/provider change, then repeat a small live payment test. Verify the recipient wallet and final payout status from the actual settlement record.
5. Clarify the provider UI: label historical intent payout addresses as snapshots and show the current destination separately, so a saved wallet change is not mistaken for a failed update.

**Release gate:** No automatic payout should use an old cached wallet merely because a current destination lookup fails.
