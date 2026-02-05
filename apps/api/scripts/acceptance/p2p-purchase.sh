#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
CONTENT_ID="${CONTENT_ID:-}"
MANIFEST_SHA256="${MANIFEST_SHA256:-}"
AMOUNT_SATS="${AMOUNT_SATS:-1000}"

if [[ -z "${CONTENT_ID}" ]]; then
  echo "Set CONTENT_ID (and optionally MANIFEST_SHA256) to run this script."
  exit 1
fi

INTENT_JSON="$(
  curl -s -X POST "${API_BASE_URL}/p2p/payments/intents" \
    -H "Content-Type: application/json" \
    -d "{\"contentId\":\"${CONTENT_ID}\",\"manifestSha256\":\"${MANIFEST_SHA256}\",\"amountSats\":\"${AMOUNT_SATS}\",\"rail\":\"onchain\"}"
)"

PAYMENT_INTENT_ID="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.paymentIntentId||'');" "${INTENT_JSON}")"
RECEIPT_TOKEN="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.receiptToken||'');" "${INTENT_JSON}")"

if [[ -z "${PAYMENT_INTENT_ID}" || -z "${RECEIPT_TOKEN}" ]]; then
  echo "Failed to create P2P intent."
  echo "${INTENT_JSON}"
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
