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

if ! grep -q '^PUBLIC_MODE=' "$API_ENV"; then
  echo "PUBLIC_MODE=quick" >> "$API_ENV"
  echo "[install] Set PUBLIC_MODE=quick (default)."
fi

prompt_install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    return
  fi

  local root_val
  root_val="$(grep '^CONTENTBOX_ROOT=' "$API_ENV" | head -n 1 | cut -d= -f2- | tr -d '"')"
  if [ -z "$root_val" ]; then
    return
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
    if ! curl -fsSL "$url" -o "$tmp_tgz"; then
      echo "[install] Download failed."
      rm -rf "$tmp_dir"
      return
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
    if ! curl -fsSL "$url" -o "$dest"; then
      echo "[install] Download failed."
      return
    fi
  fi
  chmod +x "$dest"

  # Store consent so the app won't re-prompt on first enable
  local state_file="$root_val/state.json"
  if [ ! -f "$state_file" ]; then
    echo "{\"publicSharingConsent\":{\"granted\":true,\"dontAskAgain\":true,\"grantedAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"},\"publicSharingAutoStart\":true}" > "$state_file"
  else
    node -e "const fs=require('fs');const p='$state_file';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.publicSharingConsent={granted:true,dontAskAgain:true,grantedAt:new Date().toISOString()};s.publicSharingAutoStart=true;fs.writeFileSync(p,JSON.stringify(s,null,2));"
  fi
  echo "[install] Helper tool installed."
}

prompt_install_cloudflared

bash "$API_DIR/scripts/bootstrap-dev.sh" --install
bash "$DASH_DIR/scripts/bootstrap-dev.sh" --install

echo "[install] Next steps:"
echo "  Terminal 1: cd apps/api && npm run dev"
echo "  Terminal 2: cd apps/dashboard && npm run dev"
echo "  API: http://127.0.0.1:4000"
echo "  Dashboard: http://127.0.0.1:5173"
echo "  Public server: http://127.0.0.1:${PUBLIC_PORT:-4010} (PUBLIC_PORT)"
