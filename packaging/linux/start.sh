#!/usr/bin/env bash
set -euo pipefail

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
  echo "[Certifyd Core] $*" >&2
  exit 1
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
    if [[ -n "$host" ]] && is_private_ipv4 "$host" && ! is_virtual_interface "$iface"; then
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
    if [[ -n "$host" ]]; then
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

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$script_dir"
node_bin="$app_dir/runtime/node/bin/node"
api_dir="$app_dir/apps/api"
schema_path="$api_dir/prisma/schema.prisma"
prisma_cli="$api_dir/node_modules/prisma/build/index.js"

[[ -x "$node_bin" ]] || fail "Bundled Node runtime missing: $node_bin"
[[ -d "$api_dir" ]] || fail "API runtime missing: $api_dir"
[[ -f "$schema_path" ]] || fail "Prisma schema missing: $schema_path"
[[ -f "$prisma_cli" ]] || fail "Bundled Prisma CLI missing: $prisma_cli"

default_data_root="${XDG_DATA_HOME:-"$HOME/.local/share"}/contentbox"
data_root="${CONTENTBOX_ROOT:-"$default_data_root"}"
config_dir="$data_root/config"
state_dir="$data_root/state"
log_dir="$data_root/logs"
env_file="$config_dir/api.env"
pid_file="$state_dir/certifyd-core.pid"
stdout_log="$log_dir/certifyd-core.out.log"
stderr_log="$log_dir/certifyd-core.err.log"

mkdir -p "$data_root" "$config_dir" "$state_dir" "$log_dir"

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

db_path="$data_root/contentbox.db"
export DB_MODE="${DB_MODE:-basic}"
export CONTENTBOX_ROOT="$data_root"
export DATABASE_URL="${DATABASE_URL:-"file:$db_path"}"
export CONTENTBOX_PRIVATE_BIND="${CONTENTBOX_PRIVATE_BIND:-local}"
export CONTENTBOX_BIND="${CONTENTBOX_BIND:-local}"
export PUBLIC_MODE="${PUBLIC_MODE:-off}"
export PORT="${PORT:-4000}"
export APP_BASE_URL="${APP_BASE_URL:-"http://127.0.0.1:$PORT"}"

if [[ "$LAN_MODE" -eq 1 ]]; then
  lan_hosts="$(detect_lan_hosts)"
  lan_primary_host="${lan_hosts%%,*}"
  export CONTENTBOX_PRIVATE_BIND="public"
  if [[ -n "$lan_hosts" ]]; then
    export CONTENTBOX_PRIVATE_ALLOWED_HOSTS="$(merge_host_lists "${CONTENTBOX_PRIVATE_ALLOWED_HOSTS:-}" "$lan_hosts")"
    export APP_BASE_URL="http://$lan_primary_host:$PORT"
    echo "[Certifyd Core] LAN dashboard: $APP_BASE_URL"
  else
    echo "[Certifyd Core] WARNING: no LAN IP detected; set CONTENTBOX_PRIVATE_ALLOWED_HOSTS manually if needed." >&2
  fi
fi

if [[ -z "${JWT_SECRET:-}" || "${JWT_SECRET:-}" == "change-me" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    export JWT_SECRET="$(openssl rand -hex 32)"
  else
    export JWT_SECRET="$("$node_bin" -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  fi
fi

append_config_if_missing() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$env_file" ]] || ! grep -Eq "^${key}=" "$env_file"; then
    printf '%s="%s"\n' "$key" "$value" >>"$env_file"
  fi
}

set_config_line() {
  local key="$1"
  local value="$2"
  if [[ -f "$env_file" ]] && grep -Eq "^${key}=" "$env_file"; then
    sed -i.bak "s#^${key}=.*#${key}=\"$value\"#" "$env_file" && rm -f "$env_file.bak"
  else
    printf '%s="%s"\n' "$key" "$value" >>"$env_file"
  fi
}

if [[ ! -f "$env_file" ]]; then
  {
    echo "# Certifyd Core local runtime configuration"
    echo "# This file is user data. Package updates must not overwrite it."
  } >"$env_file"
fi

append_config_if_missing "DB_MODE" "$DB_MODE"
append_config_if_missing "CONTENTBOX_ROOT" "$CONTENTBOX_ROOT"
append_config_if_missing "DATABASE_URL" "$DATABASE_URL"
append_config_if_missing "JWT_SECRET" "$JWT_SECRET"
append_config_if_missing "CONTENTBOX_PRIVATE_BIND" "$CONTENTBOX_PRIVATE_BIND"
if [[ "$LAN_MODE" -eq 1 ]]; then
  set_config_line "CONTENTBOX_PRIVATE_BIND" "$CONTENTBOX_PRIVATE_BIND"
  if [[ -n "${CONTENTBOX_PRIVATE_ALLOWED_HOSTS:-}" ]]; then
    set_config_line "CONTENTBOX_PRIVATE_ALLOWED_HOSTS" "$CONTENTBOX_PRIVATE_ALLOWED_HOSTS"
  fi
  set_config_line "APP_BASE_URL" "$APP_BASE_URL"
fi
append_config_if_missing "CONTENTBOX_BIND" "$CONTENTBOX_BIND"
append_config_if_missing "PUBLIC_MODE" "$PUBLIC_MODE"
append_config_if_missing "PORT" "$PORT"
append_config_if_missing "APP_BASE_URL" "$APP_BASE_URL"

if [[ ! -f "$db_path" ]]; then
  : >"$db_path"
fi

health_url="http://127.0.0.1:$PORT/health"
app_url="$APP_BASE_URL"

check_health() {
  "$node_bin" -e '
    const http = require("http");
    const url = process.argv[1];
    const req = http.get(url, { timeout: 1500 }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      res.on("end", () => process.exit(ok ? 0 : 1));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => process.exit(1));
  ' "$health_url" >/dev/null 2>&1
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$app_url" >/dev/null 2>&1 || true
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$app_url" >/dev/null 2>&1 || true
  fi
}

(
  cd "$api_dir"
  "$node_bin" "$prisma_cli" validate --schema "$schema_path"
  if [[ ! -d "$api_dir/node_modules/.prisma/client" ]]; then
    "$node_bin" "$prisma_cli" generate --schema "$schema_path"
  fi
  "$node_bin" "$prisma_cli" db push --schema "$schema_path" --skip-generate
)

if check_health; then
  open_browser
  exit 0
fi

if [[ -f "$pid_file" ]]; then
  existing_pid="$(tr -dc '0-9' <"$pid_file" || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    open_browser
    exit 0
  fi
fi

(
  cd "$api_dir"
  nohup "$node_bin" --import tsx src/server.ts >"$stdout_log" 2>"$stderr_log" &
  echo "$!" >"$pid_file"
)

deadline=$((SECONDS + 45))
while (( SECONDS < deadline )); do
  if check_health; then
    open_browser
    exit 0
  fi
  sleep 0.75
done

echo "[Certifyd Core] Core did not become ready. Logs:" >&2
echo "  $stdout_log" >&2
echo "  $stderr_log" >&2
tail -n 80 "$stderr_log" >&2 || true
exit 1
