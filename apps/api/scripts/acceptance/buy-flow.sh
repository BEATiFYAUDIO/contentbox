#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
CONTENT_ID="${CONTENT_ID:-}"

if [[ -z "${CONTENT_ID}" ]]; then
  echo "Set CONTENT_ID to run this script."
  exit 1
fi

OFFER_JSON="$(curl -s "${API_BASE_URL}/p2p/content/${CONTENT_ID}/offer")"
echo "Offer: ${OFFER_JSON}"

MANIFEST_SHA256="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.manifestSha256||'');" "${OFFER_JSON}")"
PRICE_SATS="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.priceSats||'1000');" "${OFFER_JSON}")"

INTENT_JSON="$(curl -s -X POST "${API_BASE_URL}/p2p/payments/intents" -H "Content-Type: application/json" -d "{\"contentId\":\"${CONTENT_ID}\",\"manifestSha256\":\"${MANIFEST_SHA256}\",\"amountSats\":\"${PRICE_SATS}\"}")"
echo "Intent: ${INTENT_JSON}"

PAYMENT_INTENT_ID="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.paymentIntentId||'');" "${INTENT_JSON}")"
RECEIPT_TOKEN="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.receiptToken||'');" "${INTENT_JSON}")"

if [[ -z "${PAYMENT_INTENT_ID}" || -z "${RECEIPT_TOKEN}" ]]; then
  echo "Failed to create intent."
  exit 1
fi

if [[ "${DEV_ALLOW_SIMULATE_PAYMENTS:-}" == "1" ]]; then
  curl -s -X POST "${API_BASE_URL}/api/dev/simulate-pay" \
    -H "Content-Type: application/json" \
    -d "{\"paymentIntentId\":\"${PAYMENT_INTENT_ID}\",\"paidVia\":\"ONCHAIN\"}" >/dev/null
else
  echo "DEV_ALLOW_SIMULATE_PAYMENTS=1 not set; skipping simulate-pay."
fi

STATUS_JSON="$(curl -s "${API_BASE_URL}/public/receipts/${RECEIPT_TOKEN}/status")"
echo "Status: ${STATUS_JSON}"

FULFILL_JSON="$(curl -s "${API_BASE_URL}/public/receipts/${RECEIPT_TOKEN}/fulfill")"
echo "Fulfill: ${FULFILL_JSON}"

OBJECT_KEY="$(node -e "const d=JSON.parse(process.argv[1]);const f=(d.files||[])[0];console.log(f?f.objectKey:'');" "${FULFILL_JSON}")"
if [[ -n "${OBJECT_KEY}" ]]; then
  curl -s -o /tmp/contentbox-buy-file.bin "${API_BASE_URL}/public/receipts/${RECEIPT_TOKEN}/file?objectKey=${OBJECT_KEY}"
  echo "Downloaded /tmp/contentbox-buy-file.bin"
fi
