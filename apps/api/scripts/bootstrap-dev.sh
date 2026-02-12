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
  echo "[bootstrap] Edit $ENV_FILE (DATABASE_URL, JWT_SECRET, CONTENTBOX_ROOT) and re-run."
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is missing in $ENV_FILE"
fi

if [ -z "${JWT_SECRET:-}" ] || [ "${JWT_SECRET}" = "change-me" ]; then
  fail "JWT_SECRET is missing or still set to 'change-me' in $ENV_FILE"
fi

if [ -z "${CONTENTBOX_ROOT:-}" ]; then
  fail "CONTENTBOX_ROOT is missing in $ENV_FILE"
fi

mkdir -p "$CONTENTBOX_ROOT"

if [ "$INSTALL_MODE" = "force" ] || { [ "$INSTALL_MODE" = "auto" ] && [ ! -d "$ROOT_DIR/node_modules" ]; }; then
  echo "[bootstrap] Installing API dependencies..."
  (cd "$ROOT_DIR" && npm install)
else
  echo "[bootstrap] Skipping npm install (node_modules present or --no-install)"
fi

# Verify Postgres reachability if possible
if command -v psql >/dev/null 2>&1; then
  echo "[bootstrap] Checking Postgres via psql..."
  if ! psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
    fail "Postgres unreachable using DATABASE_URL"
  fi
else
  if [ -d "$ROOT_DIR/node_modules/pg" ]; then
    echo "[bootstrap] Checking Postgres via node+pg..."
    node - <<'NODE'
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
const client = new Client({ connectionString: url });
client.connect().then(() => client.query('select 1')).then(() => client.end()).catch(err => {
  console.error('Postgres unreachable:', err.message);
  process.exit(1);
});
NODE
  else
    echo "[bootstrap] Skipping Postgres reachability check (psql or pg not available)."
  fi
fi

echo "[bootstrap] Prisma validate/generate..."
(cd "$ROOT_DIR" && npx prisma validate && npx prisma generate)

echo "[bootstrap] Done. Start API with:"
echo "  cd apps/api && npm run dev"
