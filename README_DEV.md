# ContentBox P2P Dev Runbook

## Environment flags
- `DEV_P2P_UNLOCK=1` to allow stream permits without payment
- `PAYMENT_PROVIDER=none` to bypass payment rails
- `PREVIEW_ENABLED=1` (default) to allow preview clamp on priced content
- `PREVIEW_MAX_BYTES=5000000` (default)

## LAN test (two machines)
1) Start seller API on Machine A.
2) Ensure content is published and has price set.
3) Generate v1 link from Share panel.
4) On Machine B, paste link into Store page and open.

## Publish (draft -> published)
1) Open content card.
2) Click **Publish** in the header.
3) If blocked, fix listed reasons (e.g., add primary file, fix split).
4) After success, manifest hash + share links are active.

## Permit + stream curl examples
```bash
API_BASE=http://127.0.0.1:4000
MANIFEST=<manifestHash>
FILEID=<primaryFileId>

# Issue permit
curl -s -X POST "$API_BASE/p2p/permits" \
  -H "Content-Type: application/json" \
  -d "{\"manifestHash\":\"$MANIFEST\",\"fileId\":\"$FILEID\",\"buyerId\":\"you@example.com\",\"requestedScope\":\"preview\"}"

# Stream with permit
curl -I "$API_BASE/content/$MANIFEST/$FILEID?t=<permit>"
curl -H "Range: bytes=0-1048575" "$API_BASE/content/$MANIFEST/$FILEID?t=<permit>" -o /tmp/part.bin
```

## Expected status codes
- Free content: 200/206 without permit
- Priced + preview enabled: 200/206 (preview clamp) even without permit
- Priced + preview disabled:
  - No permit: 402 PAYMENT_REQUIRED
  - Invalid/expired permit: 403 FORBIDDEN
  - Valid stream permit: 200/206 full

## Quick test script
```bash
cd apps/api
npx tsx src/scripts/permit_range_test.ts http://127.0.0.1:4000 <manifestHash> <fileId>
```
