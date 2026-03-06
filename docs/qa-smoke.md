# ContentBox QA Smoke Checklist

This checklist validates the current content lifecycle behavior without schema changes.

## Preconditions
- API running on `http://127.0.0.1:4000`
- Dashboard running
- Signed in as creator/admin
- Optional second browser/profile for buyer checks

## 1) Create Draft
1. Go to Content Manager → `Content` tab.
2. Create a new content item with a non-empty title and type `song`.
3. Expected:
  - One `POST /content` request returns `200`.
  - New item appears immediately in `Content` tab.
  - No page refresh required.

## 2) Upload + Publish
1. Upload a master file for the new draft.
2. Publish the item.
3. Expected:
  - Upload succeeds with `200` and file appears in the expanded card.
  - Publish succeeds and item status becomes `PUBLISHED`.

## 3) Buy Link Loads
1. Open the generated `/buy/<contentId>` link.
2. Expected:
  - Offer endpoint returns `200`.
  - Page is buyable (not removed/not found).

## 4) Complete a Purchase
1. Complete payment using current configured flow.
2. Expected:
  - Receipt eventually settles.
  - Buyer sees unlocked access.

## 5) Archive Published Item
1. Back in Content Manager, click `Archive` on the published item.
2. Expected:
  - Item leaves `Content` tab.
  - Item appears in `Archived` tab.
  - Label shows archived state.

## 6) Public Gating After Archive
1. Open `/buy/<contentId>` as non-entitled user/session.
2. Expected:
  - `410` removed behavior.
  - New purchase intents return `409 NOT_FOR_SALE`.

## 7) Buyer Access After Archive
1. Open buyer Library / owned view for the account that purchased earlier.
2. Expected:
  - Item remains accessible for entitled buyer.

## 8) Trash Draft Behavior
1. Create another draft item.
2. Click `Trash`.
3. Expected:
  - Item disappears from `Content` tab.
  - Item appears in `Trash` tab only.

## 9) Restore Draft
1. In `Trash` tab click `Restore`.
2. Expected:
  - Item returns to `Content` tab.
  - It no longer appears in `Trash`.

## 10) Delete Forever Guard
1. In `Trash` tab, click `Delete forever` for a draft item.
2. Expected:
  - Action succeeds for draft trash items.
  - Published items are blocked from permanent delete.

