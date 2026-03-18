# QA Smoke Checklist

Focused regression checks for content, buy page, and mode posture.

## Preconditions

- API running on `http://127.0.0.1:4000`
- Dashboard running
- Signed in as creator

## Content lifecycle

1. Create draft content.
2. Upload primary file.
3. Publish content.

Expected:

- draft appears immediately
- upload succeeds
- publish succeeds

## Public open/buy flow

1. Use Share/Open from UI (do not hand-craft URL).
2. Open public page and buy page.

Expected:

- page loads
- metadata/cover/preview render
- no internal provider diagnostics on buyer-facing page

## Monetization posture by mode

### Basic

- tips posture only
- no paid unlock copy

### Sovereign Creator without provider

- still basic monetization posture
- no paid unlock copy

### Sovereign Creator with provider

- provider-backed paid posture available

### Sovereign Node

- local paid posture available

## Archive behavior

1. Archive published item.
2. Verify public purchase blocked for new buyers.
3. Verify existing entitled buyers retain access.
