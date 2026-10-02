#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$(whoami)}"
if [ -n "${SUDO_USER:-}" ]; then
  REAL_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  REAL_HOME="$HOME"
fi
if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -z "${SUDO_USER:-}" ]; then
  echo "[install] Do not run install.sh as root. Re-run as a normal user." >&2
  exit 1
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

set_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$file" && rm -f "$file.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

get_env_value() {
  local file="$1"
  local key="$2"
  local line
  if [ ! -f "$file" ]; then
    return 0
  fi
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 0
  fi
  printf '%s\n' "$line" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

is_private_ipv4() {
  echo "$1" | grep -Eq '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
}

is_virtual_interface() {
  echo "$1" | grep -Eiq '^(docker|br-|veth|virbr|zt|tailscale|tun|tap|wg|podman|cni|lo)'
}

normalize_host_list() {
  tr ',[:space:]' '\n' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" | awk 'NF && !seen[$0]++' | paste -sd, -
}

merge_host_lists() {
  printf '%s\n%s\n' "${1:-}" "${2:-}" | normalize_host_list
}

detect_primary_lan_host() {
  local host iface
  if command -v ip >/dev/null 2>&1; then
    host="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
    iface="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')"
    if [ -n "$host" ] && is_private_ipv4 "$host" && ! is_virtual_interface "$iface"; then
      echo "$host"
      return 0
    fi
    host="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2 " " $4}' | while read -r dev cidr; do
      ip_addr="${cidr%/*}"
      if is_private_ipv4 "$ip_addr" && ! is_virtual_interface "$dev"; then
        echo "$ip_addr"
        break
      fi
    done)"
    if [ -n "$host" ]; then
      echo "$host"
      return 0
    fi
  fi
  hostname -I 2>/dev/null | tr ' ' '\n' | while read -r ip_addr; do
    if is_private_ipv4 "$ip_addr"; then
      echo "$ip_addr"
      break
    fi
  done
}

detect_lan_hosts() {
  local primary hosts
  primary="$(detect_primary_lan_host)"
  hosts="$primary"
  if command -v ip >/dev/null 2>&1; then
    hosts="$(printf '%s\n%s\n' "$hosts" "$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2 " " $4}' | while read -r dev cidr; do
      ip_addr="${cidr%/*}"
      if is_private_ipv4 "$ip_addr" && ! is_virtual_interface "$dev"; then
        echo "$ip_addr"
      fi
    done)" | normalize_host_list)"
  fi
  hosts="$(printf '%s\n%s\n' "$hosts" "$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' || true)" | normalize_host_list)"
  echo "$hosts"
}

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
  LAN_HOSTS="$(detect_lan_hosts)"
  LAN_PRIMARY_HOST="${LAN_HOSTS%%,*}"
  set_env_line "$API_ENV" "CONTENTBOX_PRIVATE_BIND" "public"
  if [ -n "$LAN_HOSTS" ]; then
    EXISTING_ALLOWED_HOSTS="$(get_env_value "$API_ENV" "CONTENTBOX_PRIVATE_ALLOWED_HOSTS")"
    MERGED_ALLOWED_HOSTS="$(merge_host_lists "$EXISTING_ALLOWED_HOSTS" "$LAN_HOSTS")"
    set_env_line "$API_ENV" "CONTENTBOX_PRIVATE_ALLOWED_HOSTS" "$MERGED_ALLOWED_HOSTS"
    set_env_line "$API_ENV" "APP_BASE_URL" "http://${LAN_PRIMARY_HOST}:4000"
  fi
  echo "[install] LAN mode enabled (private dashboard/API binds to LAN)."
  if [ -n "$LAN_HOSTS" ]; then
    echo "[install] LAN dashboard: http://${LAN_PRIMARY_HOST}:4000"
  else
    echo "[install] WARNING: no LAN IP detected; set CONTENTBOX_PRIVATE_ALLOWED_HOSTS manually if needed."
  fi
  echo "[install] If LAN access fails, allow tcp/4000 in your firewall."
fi

if ! grep -q '^PUBLIC_MODE=' "$API_ENV"; then
  echo "PUBLIC_MODE=off" >> "$API_ENV"
  echo "[install] Set PUBLIC_MODE=off (local only)."
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

EXISTING_DB_MODE="$(get_env_value "$API_ENV" "DB_MODE")"
if [ -z "$EXISTING_DB_MODE" ] || echo "$EXISTING_DB_MODE" | grep -q "<user>"; then
  set_env_line "$API_ENV" "DB_MODE" "basic"
  echo "[install] Using DB_MODE=basic."
else
  echo "[install] Preserving existing DB_MODE=$EXISTING_DB_MODE."
fi

ROOT_VAL="$(ensure_contentbox_root)"
mkdir -p "$ROOT_VAL"
SQLITE_URL="file:${ROOT_VAL}/contentbox.db"
EXISTING_DATABASE_URL="$(get_env_value "$API_ENV" "DATABASE_URL")"
if [ -z "$EXISTING_DATABASE_URL" ] || [ "$EXISTING_DATABASE_URL" = "file:./contentbox.db" ] || echo "$EXISTING_DATABASE_URL" | grep -q "<user>"; then
  set_env_line "$API_ENV" "DATABASE_URL" "\"${SQLITE_URL}\""
  echo "[install] Using SQLite for basic mode."
else
  echo "[install] Preserving existing DATABASE_URL."
fi
EFFECTIVE_DATABASE_URL="$(get_env_value "$API_ENV" "DATABASE_URL")"
if [[ "$EFFECTIVE_DATABASE_URL" == file:/* ]]; then
  SQLITE_DB_PATH="${EFFECTIVE_DATABASE_URL#file:}"
  SQLITE_DB_PATH="${SQLITE_DB_PATH%%\?*}"
  mkdir -p "$(dirname "$SQLITE_DB_PATH")"
  if [ ! -e "$SQLITE_DB_PATH" ]; then
    : > "$SQLITE_DB_PATH"
    echo "[install] Created empty SQLite database file."
  fi
fi

if [ "$LAN_MODE" -eq 1 ] && [ -n "${LAN_PRIMARY_HOST:-}" ]; then
  set_env_line "$DASH_ENV" "VITE_API_BASE_URL" "http://${LAN_PRIMARY_HOST}:4000"
  set_env_line "$DASH_ENV" "VITE_API_URL" "http://${LAN_PRIMARY_HOST}:4000"
else
  set_env_line "$DASH_ENV" "VITE_API_URL" "http://127.0.0.1:4000"
fi
if grep -q '^CONTENTBOX_ROOT=' "$DASH_ENV"; then
  sed -i.bak '/^CONTENTBOX_ROOT=/d' "$DASH_ENV" && rm -f "$DASH_ENV.bak"
fi

prompt_install_cloudflared() {
  local root_val
  root_val="$(grep '^CONTENTBOX_ROOT=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '"')"
  if [ -z "$root_val" ] || echo "$root_val" | grep -q "<user>"; then
    root_val="$REAL_HOME/contentbox-data"
    if grep -q '^CONTENTBOX_ROOT=' "$API_ENV"; then
      sed -i.bak "s#^CONTENTBOX_ROOT=.*#CONTENTBOX_ROOT=\"$root_val\"#" "$API_ENV" && rm -f "$API_ENV.bak"
    else
      echo "CONTENTBOX_ROOT=\"$root_val\"" >> "$API_ENV"
    fi
  fi
  mkdir -p "$root_val"
  if echo "$root_val" | grep -q "^/root/"; then
    root_val="$REAL_HOME/contentbox-data"
    sed -i.bak "s#^CONTENTBOX_ROOT=.*#CONTENTBOX_ROOT=\"$root_val\"#" "$API_ENV" && rm -f "$API_ENV.bak"
  fi
  local bin_dir="$root_val/.bin"
  local bin_name="cloudflared"
  local dest="$bin_dir/$bin_name"

  echo ""
  echo "Public test URL (optional)"
  echo "Create a temporary public test URL so others can view your local Certifyd while dev is running?"
  echo "This will download a small helper tool into:"
  echo "  $bin_dir"
  echo "Yes = public test URL while dev is running. No = local only."
  printf "Create temporary public test URL? [y/N]: "
  read -r ans
  case "$ans" in
    y|Y|yes|YES)
      if grep -q '^PUBLIC_MODE=' "$API_ENV"; then
        sed -i.bak 's/^PUBLIC_MODE=.*/PUBLIC_MODE=quick/' "$API_ENV" && rm -f "$API_ENV.bak"
      else
        echo "PUBLIC_MODE=quick" >> "$API_ENV"
      fi
      ;;
    *)
      if grep -q '^PUBLIC_MODE=' "$API_ENV"; then
        sed -i.bak 's/^PUBLIC_MODE=.*/PUBLIC_MODE=off/' "$API_ENV" && rm -f "$API_ENV.bak"
      else
        echo "PUBLIC_MODE=off" >> "$API_ENV"
      fi
      echo "[install] Public test URL disabled. Set PUBLIC_MODE=quick later to enable it."
      return
      ;;
  esac

  local state_file="$root_val/state.json"
  if [ ! -f "$state_file" ]; then
    echo "{\"publicSharingConsent\":{\"granted\":true,\"dontAskAgain\":true,\"grantedAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"},\"publicSharingAutoStart\":true}" > "$state_file"
  else
    node -e "const fs=require('fs');const p='$state_file';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.publicSharingConsent={granted:true,dontAskAgain:true,grantedAt:new Date().toISOString()};s.publicSharingAutoStart=true;fs.writeFileSync(p,JSON.stringify(s,null,2));"
  fi

  if command -v cloudflared >/dev/null 2>&1 || [ -x "$dest" ]; then
    echo "[install] cloudflared already available."
    echo "[install] PUBLIC_MODE=quick. Dev startup will create a temporary public test URL."
    return
  fi

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

  echo "[install] Helper tool installed."
  echo "[install] PUBLIC_MODE=quick. Dev startup will create a temporary public test URL."
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

echo "[install] Building integrated dashboard for http://localhost:4000"
(cd "$DASH_DIR" && npm run build)

echo "[install] Next steps:"
echo "  npm run dev:up"
echo "  Core dashboard: http://localhost:4000"
echo "  API health: http://127.0.0.1:4000/health"
echo "  Public server: http://127.0.0.1:${PUBLIC_PORT:-4010} (PUBLIC_PORT)"
echo "  Quickstart: docs/QUICKSTART.md"
