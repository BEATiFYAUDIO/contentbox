#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

pass() {
  echo "[smoke] PASS: $1"
}

echo "[smoke] Running install (basic mode)..."
if ! bash "$ROOT_DIR/install.sh" >/tmp/contentbox-install.log 2>&1; then
  cat /tmp/contentbox-install.log >&2
  fail "install.sh failed"
fi

API_PORT="${API_PORT:-4015}"
PUBLIC_PORT="${PUBLIC_PORT:-4016}"
echo "[smoke] Starting API on port $API_PORT (public port $PUBLIC_PORT)..."
(cd "$API_DIR" && PORT="$API_PORT" PUBLIC_PORT="$PUBLIC_PORT" DB_MODE=basic CONTENTBOX_LAN= IDENTITY_LEVEL_OVERRIDE=BASIC npm run dev) >/tmp/contentbox-api.log 2>&1 &
API_PID=$!

cleanup() {
  if kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for i in {1..10}; do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/tmp/contentbox-health.json; then
    break
  fi
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:${API_PORT}/health" >/tmp/contentbox-health.json; then
  cat /tmp/contentbox-api.log >&2
  fail "API /health failed"
fi
pass "API /health ok"

status=$(curl -s -o /tmp/contentbox-auth.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://127.0.0.1:${API_PORT}/auth/login" || true)

if [ "$status" = "404" ] || [ -z "$status" ]; then
  cat /tmp/contentbox-auth.json >&2
  fail "/auth/login route not found"
fi
pass "/auth/login reachable (status $status)"

echo "[smoke] Running identity gating test (basic)..."
if ! (cd "$API_DIR" && API_BASE_URL="http://127.0.0.1:${API_PORT}" EXPECT_IDENTITY_LEVEL=BASIC npx tsx src/scripts/identity_gating_test.ts) >/tmp/contentbox-identity-gating.log 2>&1; then
  cat /tmp/contentbox-identity-gating.log >&2
  fail "identity gating test failed"
fi
pass "identity gating test ok"

echo "[smoke] Running node mode tests..."
if ! (cd "$API_DIR" && npx tsx src/scripts/node_mode_test.ts) >/tmp/contentbox-node-mode.log 2>&1; then
  cat /tmp/contentbox-node-mode.log >&2
  fail "node mode test failed"
fi
pass "node mode test ok"

echo "[smoke] Running single-identity guard test (advanced-only)..."
if ! (cd "$API_DIR" && API_BASE_URL="http://127.0.0.1:${API_PORT}" npx tsx src/scripts/single_identity_guard_test.ts) >/tmp/contentbox-single-identity.log 2>&1; then
  cat /tmp/contentbox-single-identity.log >&2
  fail "single-identity guard test failed"
fi
pass "single-identity guard test ok"

echo "[smoke] Running proof bundle tests..."
if ! (cd "$API_DIR" && npx tsx src/scripts/proof_bundle_test.ts) >/tmp/contentbox-proof-bundle.log 2>&1; then
  cat /tmp/contentbox-proof-bundle.log >&2
  fail "proof bundle test failed"
fi
pass "proof bundle test ok"

if ! (cd "$API_DIR" && npx tsx src/scripts/proof_bundle_verifier_test.ts) >/tmp/contentbox-proof-bundle-verifier.log 2>&1; then
  cat /tmp/contentbox-proof-bundle-verifier.log >&2
  fail "proof bundle verifier test failed"
fi
pass "proof bundle verifier test ok"

pass "Smoke test completed"
