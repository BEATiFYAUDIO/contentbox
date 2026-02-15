#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$(whoami)}"
if [ -n "${SUDO_USER:-}" ]; then
  REAL_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  REAL_HOME="$HOME"
fi
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
  echo "[install] Public Link can download a managed helper tool after you approve the prompt."
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
  echo "[install] Set VITE_API_URL to localhost by default."
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

if ! grep -q '^PUBLIC_MODE=' "$API_ENV"; then
  echo "PUBLIC_MODE=quick" >> "$API_ENV"
  echo "[install] Set PUBLIC_MODE=quick (default)."
fi

ensure_contentbox_root() {
  local root_val
  root_val="$(grep '^CONTENTBOX_ROOT=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '\"')"
  if [ -z "$root_val" ] || echo "$root_val" | grep -q "<user>"; then
    root_val="$REAL_HOME/contentbox-data"
    if grep -q '^CONTENTBOX_ROOT=' "$API_ENV"; then
      sed -i.bak "s#^CONTENTBOX_ROOT=.*#CONTENTBOX_ROOT=\"$root_val\"#" "$API_ENV" && rm -f "$API_ENV.bak"
    else
      echo "CONTENTBOX_ROOT=\"$root_val\"" >> "$API_ENV"
    fi
  fi
  if echo "$root_val" | grep -q "^/root/"; then
    root_val="$REAL_HOME/contentbox-data"
    sed -i.bak "s#^CONTENTBOX_ROOT=.*#CONTENTBOX_ROOT=\"$root_val\"#" "$API_ENV" && rm -f "$API_ENV.bak"
  fi
  echo "$root_val"
}

ROOT_VAL="$(ensure_contentbox_root)"

if ! grep -q '^DB_MODE=' "$API_ENV"; then
  echo "DB_MODE=basic" >> "$API_ENV"
  echo "[install] Set DB_MODE=basic (default)."
fi

DB_MODE_VAL="$(grep '^DB_MODE=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '\"' | tr '[:upper:]' '[:lower:]')"
if [ -z "$DB_MODE_VAL" ]; then
  DB_MODE_VAL="basic"
fi

if [ "$DB_MODE_VAL" = "basic" ]; then
  SQLITE_URL="file:${ROOT_VAL}/contentbox.db"
  if grep -q '^DATABASE_URL=' "$API_ENV"; then
    sed -i.bak "s#^DATABASE_URL=.*#DATABASE_URL=\"${SQLITE_URL}\"#" "$API_ENV" && rm -f "$API_ENV.bak"
  else
    echo "DATABASE_URL=\"${SQLITE_URL}\"" >> "$API_ENV"
  fi
  echo "[install] Using SQLite for basic mode."
fi

if grep -q '^VITE_API_URL=' "$DASH_ENV"; then
  sed -i.bak 's#^VITE_API_URL=.*#VITE_API_URL=http://127.0.0.1:4000#' "$DASH_ENV" && rm -f "$DASH_ENV.bak"
else
  echo "VITE_API_URL=http://127.0.0.1:4000" >> "$DASH_ENV"
fi

setup_local_postgres() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "[install] Postgres not found. Please install PostgreSQL to continue."
    return 1
  fi

  local target_db="contentbox"
  local target_user="contentbox"
  local target_pass="contentbox"
  local db_url="postgresql://${target_user}:${target_pass}@127.0.0.1:5432/${target_db}"

  local psql_cmd="psql"
  if command -v sudo >/dev/null 2>&1; then
    psql_cmd="sudo -u postgres psql"
  fi

  echo "[install] Ensuring local Postgres user/db..."
  eval $psql_cmd -h 127.0.0.1 -c "\"DROP DATABASE IF EXISTS ${target_db};\"" >/dev/null 2>&1 || true
  eval $psql_cmd -h 127.0.0.1 -c "\"DROP USER IF EXISTS ${target_user};\"" >/dev/null 2>&1 || true
  eval $psql_cmd -h 127.0.0.1 -c "\"CREATE USER ${target_user} WITH PASSWORD '${target_pass}';\"" >/dev/null 2>&1 || return 1
  eval $psql_cmd -h 127.0.0.1 -c "\"CREATE DATABASE ${target_db} OWNER ${target_user};\"" >/dev/null 2>&1 || return 1

  if grep -q '^DATABASE_URL=' "$API_ENV"; then
    sed -i.bak "s#^DATABASE_URL=.*#DATABASE_URL=\"${db_url}\"#" "$API_ENV" && rm -f "$API_ENV.bak"
  else
    echo "DATABASE_URL=\"${db_url}\"" >> "$API_ENV"
  fi
  echo "[install] DATABASE_URL set for local Postgres."
}

if [ "$DB_MODE_VAL" = "advanced" ]; then
  setup_local_postgres || true
fi

prompt_install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    return
  fi

  local root_val
  root_val="$(grep '^CONTENTBOX_ROOT=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '"')"
  if [ -z "$root_val" ] || echo "$root_val" | grep -q "<user>"; then
    root_val="$HOME/contentbox-data"
    if grep -q '^CONTENTBOX_ROOT=' "$API_ENV"; then
      sed -i.bak "s#^CONTENTBOX_ROOT=.*#CONTENTBOX_ROOT=\"$root_val\"#" "$API_ENV" && rm -f "$API_ENV.bak"
    else
      echo "CONTENTBOX_ROOT=\"$root_val\"" >> "$API_ENV"
    fi
  fi
  local bin_dir="$root_val/.bin"
  local bin_name="cloudflared"
  local dest="$bin_dir/$bin_name"

  if [ -x "$dest" ]; then
    return
  fi

  echo ""
  echo "Public Link helper tool (optional)"
  echo "This will download a small helper tool into:"
  echo "  $bin_dir"
  echo "It can be removed anytime."
  printf "Download now? [y/N]: "
  read -r ans
  case "$ans" in
    y|Y|yes|YES)
      ;;
    *)
      return
      ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    if ! command -v wget >/dev/null 2>&1; then
      echo "[install] Download skipped: curl or wget is required."
      return
    fi
  fi

  mkdir -p "$bin_dir"
  local version
  version="$(grep '^CLOUDFLARED_VERSION=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '"')"
  if [ -z "$version" ]; then
    version="latest"
  fi
  local base
  if [ "$version" = "latest" ]; then
    base="https://github.com/cloudflare/cloudflared/releases/latest/download"
  else
    base="https://github.com/cloudflare/cloudflared/releases/download/$version"
  fi

  local os
  os="$(uname -s)"
  local arch
  arch="$(uname -m)"

  local url=""
  local is_tgz=0
  if [ "$os" = "Linux" ]; then
    if [ "$arch" = "x86_64" ] || [ "$arch" = "amd64" ]; then
      url="$base/cloudflared-linux-amd64"
    elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then
      url="$base/cloudflared-linux-arm64"
    fi
  elif [ "$os" = "Darwin" ]; then
    if [ "$arch" = "x86_64" ] || [ "$arch" = "amd64" ]; then
      url="$base/cloudflared-darwin-amd64.tgz"
      is_tgz=1
    elif [ "$arch" = "arm64" ]; then
      url="$base/cloudflared-darwin-arm64.tgz"
      is_tgz=1
    fi
  fi

  if [ -z "$url" ]; then
    echo "[install] Unsupported platform/arch for cloudflared download."
    return
  fi

  echo "[install] Downloading helper tool..."
  if [ "$is_tgz" -eq 1 ]; then
    tmp_dir="$(mktemp -d)"
    tmp_tgz="$tmp_dir/cloudflared.tgz"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$tmp_tgz" || { echo "[install] Download failed."; rm -rf "$tmp_dir"; return; }
    else
      wget -qO "$tmp_tgz" "$url" || { echo "[install] Download failed."; rm -rf "$tmp_dir"; return; }
    fi
    if ! tar -xzf "$tmp_tgz" -C "$tmp_dir"; then
      echo "[install] Extract failed."
      rm -rf "$tmp_dir"
      return
    fi
    if [ ! -f "$tmp_dir/cloudflared" ]; then
      echo "[install] Extracted binary not found."
      rm -rf "$tmp_dir"
      return
    fi
    cp "$tmp_dir/cloudflared" "$dest"
    rm -rf "$tmp_dir"
  else
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$dest" || { echo "[install] Download failed."; return; }
    else
      wget -qO "$dest" "$url" || { echo "[install] Download failed."; return; }
    fi
  fi
  chmod +x "$dest"

  # Store consent and enable auto-start (user opted in)
  local state_file="$root_val/state.json"
  if [ ! -f "$state_file" ]; then
    echo "{\"publicSharingConsent\":{\"granted\":true,\"dontAskAgain\":true,\"grantedAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"},\"publicSharingAutoStart\":true}" > "$state_file"
  else
    node -e "const fs=require('fs');const p='$state_file';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.publicSharingConsent={granted:true,dontAskAgain:true,grantedAt:new Date().toISOString()};s.publicSharingAutoStart=true;fs.writeFileSync(p,JSON.stringify(s,null,2));"
  fi
  echo "[install] Helper tool installed."
}

prompt_install_cloudflared || true

echo "[install] Running bootstrap scripts..."
bash "$API_DIR/scripts/bootstrap-dev.sh" --install
bash "$DASH_DIR/scripts/bootstrap-dev.sh" --install

# Ensure local dev binaries exist (vite/tsx) even if npm install was interrupted.
if [ ! -x "$API_DIR/node_modules/.bin/tsx" ]; then
  echo "[install] API deps missing (tsx). Installing..."
  (cd "$API_DIR" && npm install)
fi
if [ ! -x "$DASH_DIR/node_modules/.bin/vite" ]; then
  echo "[install] Dashboard deps missing (vite). Installing..."
  (cd "$DASH_DIR" && npm install)
fi

echo "[install] Next steps:"
echo "  Terminal 1: cd apps/api && npm run dev"
echo "  Terminal 2: cd apps/dashboard && npm run dev"
echo "  API: http://127.0.0.1:4000"
echo "  Dashboard: http://127.0.0.1:5173"
echo "  Public server: http://127.0.0.1:${PUBLIC_PORT:-4010} (PUBLIC_PORT)"
