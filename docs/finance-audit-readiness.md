# Finance Audit Readiness Checklist (Certifyd)

Scope: dashboard presentation and control-surface discipline for financial auditability.

## System Model
- Royalties = source truth (participation, role, share, lifecycle context).
- Revenue = projection (sales, earnings, payouts, infrastructure views derived from truth).
- Rule: every Revenue number must be explainable by Royalties/ledger evidence.

## Control Objectives
1. Single source of truth
- Revenue does not redefine participation/share semantics.
- Royalties definitions are referenced from Revenue surfaces.

2. State separation
- Earned (accrued), Pending (payable/remittance pending), Paid (remitted), Failed (not remitted).
- UI labels and summaries never collapse earned vs remitted.

3. Traceability
- Totals are drillable to row evidence.
- Row evidence links to content, intent/reference, and status.

4. Idempotent payout interpretation
- Payout status is execution truth only.
- "Paid" wording is interpreted as remitted by configured path (provider-managed or direct), not guaranteed local wallet receipt.

5. Reconciliation framing
- Sales input, earnings projection, and payout execution are shown as separate layers.
- Cross-page wording preserves layer boundaries.

## UI Checklist (Current Branch)
- [x] Revenue header states end-to-end flow and Royalties linkage.
- [x] Revenue Overview explains Sales/Earnings/Payouts/Node boundaries.
- [x] Sales page states it is buyer-payment input and points to Royalties for share definitions.
- [x] Earnings page states participation/share source and uses row-level ledger.
- [x] Earnings ledger includes scope filters (source, status, role, origin).
- [x] Payouts page clarifies remittance execution semantics and provider-managed forwarding.
- [x] Node & Wallet page scoped to infrastructure context only.
- [x] Royalties page framed as participation/share source truth.

## Evidence Expectations (for audit package)
- Revenue totals by period.
- Earnings rows with status breakdown.
- Payout rows with references and attempt metadata.
- Royalties participation/split context for supporting entitlement.
- Timestamped export and app version/commit.

## Later Enhancements (non-UI)
- Reconciliation report endpoint (period deltas and explanations).
- Immutable audit export manifest (hash/signature).
- Financial change log with versioned metric definitions.
- Operational controls for payout retries/overrides with actor logging.
