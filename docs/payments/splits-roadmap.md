# Split Distribution Roadmap (Ledger → Non-Custodial Lightning Payouts)

## Current state (today)
- **Single-node Lightning custody**: The seller/creator box runs LND. All sats land on that node.
- **Split accounting is ledger-first**: Each purchase creates a `Settlement` and `SettlementLine` rows (ledger only).
- **No automated payout yet**: Recipients are recorded and “owed” but not auto-paid.
- **Buy flow**: payment intent → refresh → finalizePurchase → settlement/lines → entitlement → receipt token.
- **Delivery**: public tunnel for payments + optional LAN streaming fallback.

### Where sats land right now
All payments settle on the seller’s node. Split recipients are **not paid automatically** yet. The ledger is the source of truth for what is owed.

## Why ledger-first
- Low friction for MVP (simple, robust, fewer external dependencies).
- Enables clear audit trails and dispute resolution.
- Lets us iterate on payout UX without breaking buy flow.

---

## Phase 1 — Practical MVP (ledger-first)
**Goal:** Payments work end-to-end, splits recorded, owner manually pays out.

Acceptance criteria:
- Lightning payment settles on seller node.
- `Settlement` + `SettlementLine` created for each paid intent.
- UI shows allocations after payment.
- Manual payout workflow documented (no automation required).

## Phase 2 — Semi-automatic payouts (still single-node custody)
**Goal:** Reduce owner friction while keeping custody centralized.

Ideas:
- Payout destinations on identities (Lightning Address / LNURLp).
- “Pay all owed” tool that batches Lightning payments.
- Failures tracked and retried, no double-pay.

Acceptance criteria:
- One-click payout for current cycle.
- Clear status for each recipient.
- Retry queue for failures.

## Phase 3 — Distributed installer (multi-node testing)
**Goal:** Make it easy to spin up multiple nodes for real collaborator testing.

Ideas:
- Windows-first installer bundle with LND + ContentBox.
- Optional pruned Bitcoin Core + LND (or Neutrino) configuration.
- Second machine can run a “collaborator node” for testing payouts.

Acceptance criteria:
- Installers for 2+ machines.
- End-to-end buy flow works with collaborator nodes in test mode.

## Phase 4 — Non-custodial split payouts (node-to-node)
**Goal:** Real-time payouts to collaborator nodes with minimal custody.

Key challenges:
- Lightning liquidity + fee handling.
- Retries and timeout handling.
- Routing failures and partial payouts.
- Recipient node offline behavior.

Acceptance criteria:
- Paid intent triggers payout to recipients’ nodes.
- Deterministic rounding and reconciliation.
- Transparent payout logs.

---

## Key product decisions
- **Custody (today):** Single-node custody is acceptable for MVP.
- **Payout timing:** Ledger first; payouts later to reduce friction.
- **Failures:** Always record the ledger even if payout fails.

## Testing notes
- **Self-payments are blocked** by LND (`lncli` paying its own invoice is expected to fail).
- Use a **phone wallet** or external node on LTE/5G to pay.
- For verification: `lncli subscribeinvoices` shows settlement events.

## Security notes
- **Never expose macaroons** in client or logs.
- **Receipt tokens are short-lived** and bound to content.
- **All Lightning calls happen server-side** only.
