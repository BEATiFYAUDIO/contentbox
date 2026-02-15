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
if ! DB_MODE=basic bash "$ROOT_DIR/install.sh" >/tmp/contentbox-install.log 2>&1; then
  cat /tmp/contentbox-install.log >&2
  fail "install.sh failed"
fi

echo "[smoke] Starting API..."
(cd "$API_DIR" && npm run dev) >/tmp/contentbox-api.log 2>&1 &
API_PID=$!

cleanup() {
  if kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sleep 4

if ! curl -fsS http://127.0.0.1:4000/health >/tmp/contentbox-health.json; then
  cat /tmp/contentbox-api.log >&2
  fail "API /health failed"
fi
pass "API /health ok"

status=$(curl -s -o /tmp/contentbox-auth.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:4000/auth/login || true)

if [ "$status" = "404" ] || [ -z "$status" ]; then
  cat /tmp/contentbox-auth.json >&2
  fail "/auth/login route not found"
fi
pass "/auth/login reachable (status $status)"

echo "[smoke] Building dashboard..."
if ! (cd "$ROOT_DIR/apps/dashboard" && npm run build) >/tmp/contentbox-dashboard.log 2>&1; then
  cat /tmp/contentbox-dashboard.log >&2
  fail "dashboard build failed"
fi
pass "dashboard build ok"

pass "Smoke test completed"
