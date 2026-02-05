#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:4000}"
TOKEN="${TOKEN:-}"
CONTENT_ID="${CONTENT_ID:-}"
PRICE_SATS="${PRICE_SATS:-1000}"

if [[ -z "$TOKEN" || -z "$CONTENT_ID" ]]; then
  echo "Usage: TOKEN=... CONTENT_ID=... [PRICE_SATS=1000] $0"
  exit 1
fi

hdr=( -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" )

# Set price
curl -sS "${API_BASE}/content/${CONTENT_ID}/price" -X PATCH "${hdr[@]}" -d "{\"priceSats\":\"${PRICE_SATS}\"}" | jq .

# Offer
curl -sS "${API_BASE}/p2p/content/${CONTENT_ID}/offer" | jq .

# Create intent
INTENT=$(curl -sS "${API_BASE}/p2p/payments/intents" -X POST -H "Content-Type: application/json" -d "{\"contentId\":\"${CONTENT_ID}\",\"amountSats\":\"${PRICE_SATS}\"}")
echo "$INTENT" | jq .
RECEIPT=$(echo "$INTENT" | jq -r .receiptToken)
PID=$(echo "$INTENT" | jq -r .paymentIntentId)

# Simulate pay (dev only)
curl -sS "${API_BASE}/api/dev/simulate-pay" -X POST "${hdr[@]}" -d "{\"paymentIntentId\":\"${PID}\",\"paidVia\":\"ONCHAIN\"}" | jq .

# Status
curl -sS "${API_BASE}/public/receipts/${RECEIPT}/status" | jq .

# Fulfill
curl -sS "${API_BASE}/public/receipts/${RECEIPT}/fulfill" | jq .

echo "Receipt: ${API_BASE}/public/receipts/${RECEIPT}/status"
