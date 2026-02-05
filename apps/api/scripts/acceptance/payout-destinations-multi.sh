#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"

if [[ -z "${EMAIL}" || -z "${PASSWORD}" ]]; then
  echo "Set EMAIL and PASSWORD env vars to run this script."
  exit 1
fi

TOKEN="$(
  curl -s -X POST "${API_BASE_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(d.token||d.accessToken||'');"
)"

if [[ -z "${TOKEN}" ]]; then
  echo "Failed to obtain auth token."
  exit 1
fi

MANUAL_ID="$(
  curl -s "${API_BASE_URL}/payout-methods" \
  | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const m=d.find((x)=>x.code==='manual');console.log(m?m.id:'');"
)"

if [[ -z "${MANUAL_ID}" ]]; then
  echo "Manual payout method not found."
  exit 1
fi

curl -s -X POST "${API_BASE_URL}/identities" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"payoutMethodId\":\"${MANUAL_ID}\",\"value\":\"payments@myband.example\",\"label\":\"Interac (Band Wallet)\"}" >/dev/null

curl -s -X POST "${API_BASE_URL}/identities" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"payoutMethodId\":\"${MANUAL_ID}\",\"value\":\"billing@studio.example\",\"label\":\"Interac (Studio)\"}" >/dev/null

COUNT="$(
  curl -s "${API_BASE_URL}/identities" -H "Authorization: Bearer ${TOKEN}" \
  | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const c=d.filter((x)=>x.payoutMethod?.code==='manual').length;console.log(c);"
)"

echo "Manual payout destinations: ${COUNT}"
