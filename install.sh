#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
DASH_DIR="$ROOT_DIR/apps/dashboard"

LAN_MODE=0
for arg in "$@"; do
  case "$arg" in
    --lan) LAN_MODE=1 ;;
    --help|-h)
      echo "Usage: $0 [--lan]"
      exit 0
      ;;
  esac
done

fail() {
  echo "[install] $1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd node
require_cmd npm

echo "[install] Node: $(node -v)"
echo "[install] npm:  $(npm -v)"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[install] cloudflared not found in PATH."
  echo "[install] Public Link will auto-download a managed binary when first enabled."
  echo "[install] (Optional) You can still install cloudflared system-wide if preferred."
fi

API_ENV="$API_DIR/.env"
API_ENV_EXAMPLE="$API_DIR/.env.example"
DASH_ENV="$DASH_DIR/.env"
DASH_ENV_EXAMPLE="$DASH_DIR/.env.example"

if [ ! -f "$API_ENV" ]; then
  if [ ! -f "$API_ENV_EXAMPLE" ]; then
    fail "Missing $API_ENV_EXAMPLE"
  fi
  cp "$API_ENV_EXAMPLE" "$API_ENV"
  echo "[install] Created $API_ENV from example."
  echo "[install] Edit $API_ENV (DATABASE_URL) if needed."
fi

if [ ! -f "$DASH_ENV" ]; then
  if [ ! -f "$DASH_ENV_EXAMPLE" ]; then
    fail "Missing $DASH_ENV_EXAMPLE"
  fi
  cp "$DASH_ENV_EXAMPLE" "$DASH_ENV"
  echo "[install] Created $DASH_ENV from example."
  echo "[install] Edit $DASH_ENV if API is not localhost."
fi

if [ "$LAN_MODE" -eq 1 ]; then
  if grep -q '^CONTENTBOX_BIND=' "$API_ENV"; then
    sed -i.bak 's/^CONTENTBOX_BIND=.*/CONTENTBOX_BIND=public/' "$API_ENV" && rm -f "$API_ENV.bak"
  else
    echo "CONTENTBOX_BIND=public" >> "$API_ENV"
  fi
  echo "[install] LAN mode enabled (CONTENTBOX_BIND=public)."
  echo "[install] If LAN access fails, allow tcp/4000 in your firewall."
fi

bash "$API_DIR/scripts/bootstrap-dev.sh" --install
bash "$DASH_DIR/scripts/bootstrap-dev.sh" --install

echo "[install] Next steps:"
echo "  Terminal 1: cd apps/api && npm run dev"
echo "  Terminal 2: cd apps/dashboard && npm run dev"
echo "  API: http://127.0.0.1:4000"
echo "  Dashboard: http://127.0.0.1:5173"
echo "  Public server: http://127.0.0.1:${PUBLIC_PORT:-4010} (PUBLIC_PORT)"
