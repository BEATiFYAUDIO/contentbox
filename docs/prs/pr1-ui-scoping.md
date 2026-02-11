# PR1 — UI Scoping (Collaborator vs Seller)

## Summary
This PR adds a derived UI role to scope navigation and pages for collaborators vs sellers.

Key changes:
- Derived role endpoint: `GET /me/role` (seller vs collaborator).
- Collaborator navigation shows only: Invites, Earnings, Get Paid, Withdrawals.
- Seller navigation retains Revenue + Splits management.
- Added Withdrawals page (read-only view of payouts).
- Enforced role gating so collaborators don’t see Payment Rails or Split editor.

## How To Test (Local)
1. Start API + dashboard.
2. Login as a user with no published content and no rails configured:
   - Sidebar should show only Invites, Earnings, Get Paid, Withdrawals.
3. Login as a seller (owns content or rails configured):
   - Sidebar shows full Revenue + Splits tooling.
4. Open Withdrawals:
   - Empty state appears when no payouts exist.
5. Verify collaborator cannot access `/finance` or `/splits` pages (redirects to Earnings).
