#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"

API_PORT="${API_PORT:-4017}"
CONTENTBOX_ROOT="${CONTENTBOX_ROOT:-$(mktemp -d /tmp/contentbox-smoke-invite-XXXXXX)}"
DATABASE_URL="${DATABASE_URL:-file:${CONTENTBOX_ROOT}/smoke.db}"
API_BASE_URL="http://127.0.0.1:${API_PORT}"
JWT_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"

echo "[smoke-invite-split] CONTENTBOX_ROOT=${CONTENTBOX_ROOT}"
echo "[smoke-invite-split] API_BASE_URL=${API_BASE_URL}"

api_port_is_open() {
  (: >"/dev/tcp/127.0.0.1/${API_PORT}") >/dev/null 2>&1
}

cleanup() {
  local exit_code=$?
  local cleanup_failed=0
  if [[ -n "${API_PID:-}" ]] && kill -0 -- "-${API_PID}" >/dev/null 2>&1; then
    kill -TERM -- "-${API_PID}" >/dev/null 2>&1 || true
    for _ in {1..50}; do
      if ! kill -0 -- "-${API_PID}" >/dev/null 2>&1 && ! api_port_is_open; then
        break
      fi
      sleep 0.1
    done
    if kill -0 -- "-${API_PID}" >/dev/null 2>&1 || api_port_is_open; then
      kill -KILL -- "-${API_PID}" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        if ! kill -0 -- "-${API_PID}" >/dev/null 2>&1 && ! api_port_is_open; then
          break
        fi
        sleep 0.1
      done
    fi
    if kill -0 -- "-${API_PID}" >/dev/null 2>&1 || api_port_is_open; then
      echo "[smoke-invite-split] FAIL: test API did not stop cleanly" >&2
      cleanup_failed=1
    else
      wait "${API_PID}" >/dev/null 2>&1 || true
    fi
  elif api_port_is_open; then
    echo "[smoke-invite-split] FAIL: test API port remained open" >&2
    cleanup_failed=1
  fi
  if [[ "${cleanup_failed}" -ne 0 ]]; then
    return 1
  fi
  return "${exit_code}"
}
trap cleanup EXIT

touch "$CONTENTBOX_ROOT/smoke.db"
(cd "$API_DIR" && DATABASE_URL="$DATABASE_URL" \
  ./node_modules/.bin/prisma db push --schema prisma/schema.prisma --skip-generate)

(cd "$API_DIR" && exec setsid env \
  PORT="$API_PORT" \
  CONTENTBOX_ROOT="$CONTENTBOX_ROOT" \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  NODE_MODE=lan \
  PRODUCT_TIER=lan \
  STORAGE=sqlite \
  PUBLIC_MODE=off \
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
