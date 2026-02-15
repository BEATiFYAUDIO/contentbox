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
  echo "[bootstrap] Edit $ENV_FILE (DATABASE_URL) if needed."
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # replace in place
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

normalize_content_root() {
  local raw="$1"
  local v="${raw%\"}"
  v="${v#\"}"
  if [ -z "$v" ]; then
    echo "${HOME}/contentbox-data"
    return
  fi
  case "$v" in
    *"<user>"*|*"<USER>"*|*"<username>"*)
      echo "${HOME}/contentbox-data"
      return
      ;;
    "/home/<user>"*|"/home/<USER>"*)
      echo "${HOME}/contentbox-data"
      return
      ;;
  esac
  echo "$v"
}

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is missing in $ENV_FILE"
fi

if [ -z "${JWT_SECRET:-}" ] || [ "${JWT_SECRET}" = "change-me" ]; then
  JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  set_env "JWT_SECRET" "$JWT_SECRET"
  echo "[bootstrap] Generated JWT_SECRET."
fi

CONTENTBOX_ROOT="$(normalize_content_root "${CONTENTBOX_ROOT:-}")"
set_env "CONTENTBOX_ROOT" "\"${CONTENTBOX_ROOT}\""
echo "[bootstrap] CONTENTBOX_ROOT: ${CONTENTBOX_ROOT}"

mkdir -p "$CONTENTBOX_ROOT"

if [ "$INSTALL_MODE" = "force" ] || { [ "$INSTALL_MODE" = "auto" ] && [ ! -d "$ROOT_DIR/node_modules" ]; }; then
  echo "[bootstrap] Installing API dependencies..."
  (cd "$ROOT_DIR" && npm install)
else
  echo "[bootstrap] Skipping npm install (node_modules present or --no-install)"
fi

echo "[bootstrap] Prisma validate/generate..."
(cd "$ROOT_DIR" && npx prisma validate && npx prisma generate)

# Verify Postgres reachability if possible
if command -v psql >/dev/null 2>&1; then
  DB_URL_PSQL="$(node - <<'NODE'
const { URL } = require('url');
const raw = process.env.DATABASE_URL || '';
try {
  const u = new URL(raw);
  u.search = '';
  console.log(u.toString());
} catch {
  console.log(raw);
}
NODE
)"
  echo "[bootstrap] Checking Postgres via psql..."
  if ! psql "$DB_URL_PSQL" -c "select 1" >/dev/null 2>&1; then
    fail "Postgres unreachable using DATABASE_URL"
  fi
else
  if [ -d "$ROOT_DIR/node_modules/pg" ]; then
    echo "[bootstrap] Checking Postgres via node+pg..."
    (cd "$ROOT_DIR" && node - <<'NODE')
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

is_local_db() {
  node - <<'NODE'
const { URL } = require('url');
const raw = process.env.DATABASE_URL || '';
try {
  const u = new URL(raw);
  const host = u.hostname;
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  process.exit(local ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if [ "${CONTENTBOX_ALLOW_MIGRATE:-}" = "1" ] || is_local_db; then
  echo "[bootstrap] Applying database schema..."
  if [ -d "$ROOT_DIR/prisma/migrations" ] && [ "$(ls -A "$ROOT_DIR/prisma/migrations" 2>/dev/null)" ]; then
    echo "[bootstrap] Detected migrations. Running migrate deploy..."
    if ! (cd "$ROOT_DIR" && npx prisma migrate deploy); then
      fail "Prisma migrate deploy failed"
    fi
  else
    echo "[bootstrap] No migrations found. Running prisma db push..."
    if ! (cd "$ROOT_DIR" && npx prisma db push); then
      fail "Prisma db push failed"
    fi
  fi
else
  echo "[bootstrap] Skipping schema apply (non-local DB). Set CONTENTBOX_ALLOW_MIGRATE=1 to override."
fi

echo "[bootstrap] Done. Start API with:"
echo "  cd apps/api && npm run dev"
