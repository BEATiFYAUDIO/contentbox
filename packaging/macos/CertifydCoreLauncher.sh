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
  if [[ "${CERTIFYD_NO_BROWSER:-}" != "1" ]]; then
    osascript -e "display alert \"Certifyd Core\" message \"$*\" as critical" >/dev/null 2>&1 || true
  fi
  echo "[Certifyd Core] $*" >&2
  exit 1
}

is_private_ipv4() {
  echo "$1" | grep -Eq '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
}

is_virtual_interface() {
  echo "$1" | grep -Eiq '^(lo|utun|awdl|llw|bridge|gif|stf|anpi|zt|tun|tap|wg|tailscale)'
}

normalize_host_list() {
  tr ',[:space:]' '\n' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" | awk 'NF && !seen[$0]++' | paste -sd, -
}

merge_host_lists() {
  printf '%s\n%s\n' "${1:-}" "${2:-}" | normalize_host_list
}

detect_primary_lan_host() {
  local iface host
  iface="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2; exit}')"
  if [[ -n "$iface" ]] && ! is_virtual_interface "$iface"; then
    host="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$host" ]] && is_private_ipv4 "$host"; then
      echo "$host"
      return 0
    fi
  fi
  ifconfig 2>/dev/null | awk '
    /^[a-zA-Z0-9]/ { iface=$1; sub(":", "", iface) }
    /inet / { print iface " " $2 }
  ' | while read -r dev ip_addr; do
    if is_private_ipv4 "$ip_addr" && ! is_virtual_interface "$dev"; then
      echo "$ip_addr"
      break
    fi
  done
}

detect_lan_hosts() {
  local primary hosts
  primary="$(detect_primary_lan_host)"
  hosts="$(printf '%s\n%s\n' "$primary" "$(ifconfig 2>/dev/null | awk '
    /^[a-zA-Z0-9]/ { iface=$1; sub(":", "", iface) }
    /inet / { print iface " " $2 }
  ' | while read -r dev ip_addr; do
    if is_private_ipv4 "$ip_addr" && ! is_virtual_interface "$dev"; then
      echo "$ip_addr"
    fi
  done)" | normalize_host_list)"
  echo "$hosts"
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
resources_dir="$(cd -- "$script_dir/../Resources" && pwd)"
app_dir="$resources_dir/app"
node_bin="$resources_dir/runtime/node/bin/node"
api_dir="$app_dir/apps/api"
schema_path="$api_dir/prisma/schema.prisma"
prisma_cli="$api_dir/node_modules/prisma/build/index.js"

[[ -x "$node_bin" ]] || fail "Bundled Node runtime missing: $node_bin"
[[ -d "$api_dir" ]] || fail "API runtime missing: $api_dir"
[[ -f "$schema_path" ]] || fail "Prisma schema missing: $schema_path"
[[ -f "$prisma_cli" ]] || fail "Bundled Prisma CLI missing: $prisma_cli"

default_data_root="$HOME/Library/Application Support/ContentBox"
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
  export JWT_SECRET="$("$node_bin" -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
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
    echo "# This file is user data. App updates must not overwrite it."
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
    const req = http.get(process.argv[1], { timeout: 1500 }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      res.on("end", () => process.exit(ok ? 0 : 1));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => process.exit(1));
  ' "$health_url" >/dev/null 2>&1
}

open_dashboard() {
  if [[ "${CERTIFYD_NO_BROWSER:-}" == "1" ]]; then
    return 0
  fi
  open "$app_url" >/dev/null 2>&1 || true
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
  open_dashboard
  exit 0
fi

if [[ -f "$pid_file" ]]; then
  existing_pid="$(tr -dc '0-9' <"$pid_file" || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    open_dashboard
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
    open_dashboard
    exit 0
  fi
  sleep 0.75
done

tail -n 80 "$stderr_log" >&2 || true
fail "Core did not become ready. Logs are in $log_dir"
