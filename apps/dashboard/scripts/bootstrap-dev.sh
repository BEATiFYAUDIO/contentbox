#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

INSTALL_MODE="auto"
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL_MODE="force" ;;
    --no-install) INSTALL_MODE="skip" ;;
    --help|-h)
      echo "Usage: $0 [--install|--no-install]"
      exit 0
      ;;
  esac
done

fail() {
  echo "[bootstrap] $1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd node
require_cmd npm

echo "[bootstrap] Node: $(node -v)"
echo "[bootstrap] npm:  $(npm -v)"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    fail "Missing $ENV_EXAMPLE"
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "[bootstrap] Created $ENV_FILE from example."
  echo "[bootstrap] Edit $ENV_FILE if API is not localhost."
fi

if [ "$INSTALL_MODE" = "force" ] || { [ "$INSTALL_MODE" = "auto" ] && [ ! -d "$ROOT_DIR/node_modules" ]; }; then
  echo "[bootstrap] Installing dashboard dependencies..."
  (cd "$ROOT_DIR" && npm install)
else
  echo "[bootstrap] Skipping npm install (node_modules present or --no-install)"
fi

echo "[bootstrap] Done. Start dashboard with:"
echo "  cd apps/dashboard && npm run dev"
