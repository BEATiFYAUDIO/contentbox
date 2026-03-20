#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"

API_PORT="${API_PORT:-4017}"
CONTENTBOX_ROOT="${CONTENTBOX_ROOT:-$(mktemp -d /tmp/contentbox-smoke-invite-XXXXXX)}"
DATABASE_URL="${DATABASE_URL:-file:${CONTENTBOX_ROOT}/smoke.db}"
API_BASE_URL="http://127.0.0.1:${API_PORT}"

echo "[smoke-invite-split] CONTENTBOX_ROOT=${CONTENTBOX_ROOT}"
echo "[smoke-invite-split] API_BASE_URL=${API_BASE_URL}"

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

(cd "$API_DIR" && \
  PORT="$API_PORT" \
  CONTENTBOX_ROOT="$CONTENTBOX_ROOT" \
  DATABASE_URL="$DATABASE_URL" \
  NODE_ENV=development \
  npm run start:api) >/tmp/contentbox-smoke-invite-api.log 2>&1 &
API_PID=$!

for _ in {1..45}; do
  if curl -fsS "${API_BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${API_BASE_URL}/health" >/dev/null 2>&1; then
  cat /tmp/contentbox-smoke-invite-api.log >&2
  echo "[smoke-invite-split] FAIL: api did not become healthy" >&2
  exit 1
fi

(cd "$API_DIR" && API_BASE_URL="$API_BASE_URL" npm run test:smoke-invite-split)
echo "[smoke-invite-split] PASS"

