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
if [ -f "$ENV_FILE" ]; then
  # Only load valid KEY=VALUE lines to avoid breaking on comments or notes.
  # shellcheck source=/dev/null
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE")
fi
set +a

DB_MODE="basic"
set_env "DB_MODE" "$DB_MODE"

if [ -z "${JWT_SECRET:-}" ] || [ "${JWT_SECRET}" = "change-me" ]; then
  JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  set_env "JWT_SECRET" "$JWT_SECRET"
  echo "[bootstrap] Generated JWT_SECRET."
fi

CONTENTBOX_ROOT="$(normalize_content_root "${CONTENTBOX_ROOT:-}")"
set_env "CONTENTBOX_ROOT" "\"${CONTENTBOX_ROOT}\""
echo "[bootstrap] CONTENTBOX_ROOT: ${CONTENTBOX_ROOT}"
DATABASE_URL="file:${CONTENTBOX_ROOT}/contentbox.db"
set_env "DATABASE_URL" "\"${DATABASE_URL}\""
echo "[bootstrap] DATABASE_URL: ${DATABASE_URL}"

mkdir -p "$CONTENTBOX_ROOT"

if [ "$INSTALL_MODE" = "force" ] || { [ "$INSTALL_MODE" = "auto" ] && [ ! -d "$ROOT_DIR/node_modules" ]; }; then
  echo "[bootstrap] Installing API dependencies..."
  (cd "$ROOT_DIR" && npm install)
else
  echo "[bootstrap] Skipping npm install (node_modules present or --no-install)"
fi

check_prisma_versions() {
  PRISMA_BASE="$ROOT_DIR" node - <<'NODE'
const fs = require("fs");
const path = require("path");
const base = process.env.PRISMA_BASE || process.cwd();
function readVersion(p) {
  try {
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    return pkg.version || "";
  } catch {
    return "";
  }
}
const prisma = readVersion(path.join(base, "node_modules", "prisma", "package.json"));
const client = readVersion(path.join(base, "node_modules", "@prisma", "client", "package.json"));
if (!prisma || !client) {
  console.error("[bootstrap] Prisma packages missing. Run npm install.");
  process.exit(1);
}
if (prisma !== client) {
  console.error(`[bootstrap] Prisma version mismatch: prisma ${prisma} vs @prisma/client ${client}`);
  process.exit(1);
}
NODE
}

echo "[bootstrap] Checking Prisma versions..."
check_prisma_versions

SCHEMA_PATH="prisma/schema.prisma"

echo "[bootstrap] Prisma validate/generate..."
(cd "$ROOT_DIR" && npx prisma validate --schema "$SCHEMA_PATH" && npx prisma generate --schema "$SCHEMA_PATH")

echo "[bootstrap] Applying SQLite schema via db push..."
if ! (cd "$ROOT_DIR" && npx prisma db push --schema "$SCHEMA_PATH"); then
  fail "Prisma db push failed"
fi

echo "[bootstrap] Done. Start API with:"
echo "  cd apps/api && npm run dev"
