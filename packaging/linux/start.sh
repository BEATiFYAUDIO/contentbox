#!/usr/bin/env bash
set -euo pipefail

ORIGINAL_ARGS=("$@")
LAN_MODE=0
FIRST_RUN_QUICK=0
for arg in "$@"; do
  case "$arg" in
    --lan) LAN_MODE=1 ;;
    --first-run-quick) FIRST_RUN_QUICK=1 ;;
    --help|-h)
      echo "Usage: $0 [--lan]"
      exit 0
      ;;
  esac
done

failure_reported=0
launcher_lock_held=0
launcher_lock_dir=""
splash_fd=""
splash_pid=""

start_launcher_splash() {
  if [[ "${CI:-}" == "true" || "${CERTIFYD_LAUNCHER_NO_UI:-}" == "1" || "${CERTIFYD_NO_BROWSER:-}" == "1" ]]; then
    return 0
  fi
  if command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    coproc CERTIFYD_SPLASH {
      zenity --progress --pulsate --auto-close --no-cancel \
        --title="Certifyd Core" \
        --text="Preparing the local dashboard..." \
        --width=420 \
        --window-icon="$script_dir/assets/certifyd-core.png" 2>/dev/null
    }
    splash_fd="${CERTIFYD_SPLASH[1]}"
    splash_pid="$CERTIFYD_SPLASH_PID"
  fi
}

set_launcher_status() {
  local message="$1"
  echo "[Certifyd Core] $message"
  if [[ -n "$splash_fd" ]]; then
    printf '# %s\n' "$message" >&"$splash_fd" 2>/dev/null || true
  fi
}

close_launcher_splash() {
  if [[ -n "$splash_fd" ]]; then
    exec {splash_fd}>&- 2>/dev/null || true
    splash_fd=""
  fi
  if [[ -n "$splash_pid" ]]; then
    wait "$splash_pid" 2>/dev/null || true
    splash_pid=""
  fi
}

show_launch_failure() {
  local message="$1"
  close_launcher_splash
  if [[ "${CERTIFYD_NO_BROWSER:-}" != "1" ]] && command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    if zenity --question --title="Certifyd Core" \
      --text="Core could not start.\n\n$message\n\nLogs: ${log_dir:-$HOME/.local/share/contentbox/logs}" \
      --ok-label="Retry" --cancel-label="View Logs" \
      --window-icon="$script_dir/assets/certifyd-core.png" 2>/dev/null; then
      nohup "$0" "${ORIGINAL_ARGS[@]}" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "${log_dir:-$HOME/.local/share/contentbox/logs}" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "${CERTIFYD_NO_BROWSER:-}" != "1" ]] && command -v notify-send >/dev/null 2>&1; then
    notify-send --urgency=critical "Certifyd Core" "$message" >/dev/null 2>&1 || true
  fi
  echo "[Certifyd Core] $message" >&2
}

release_launcher_lock() {
  if [[ "$launcher_lock_held" -eq 1 && -n "$launcher_lock_dir" ]]; then
    rm -f "$launcher_lock_dir/owner"
    rmdir "$launcher_lock_dir" >/dev/null 2>&1 || true
    launcher_lock_held=0
  fi
}

launcher_exit() {
  local status="$?"
  set +e
  release_launcher_lock
  if [[ "$status" -ne 0 && "$failure_reported" -eq 0 ]]; then
    show_launch_failure "Core could not start. Logs are in ${log_dir:-$HOME/.local/share/contentbox/logs}."
  fi
  return "$status"
}
trap launcher_exit EXIT

fail() {
  failure_reported=1
  show_launch_failure "$*"
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

subtract_host_lists() {
  local existing="${1:-}" removed="${2:-}" item remove
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    remove=0
    while IFS= read -r old; do
      if [[ "$item" == "$old" ]]; then
        remove=1
        break
      fi
    done < <(printf '%s' "$removed" | tr ',' '\n')
    if [[ "$remove" -eq 0 ]]; then
      printf '%s\n' "$item"
    fi
  done < <(printf '%s' "$existing" | tr ',' '\n') | normalize_host_list
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
start_launcher_splash
set_launcher_status "Checking the local runtime..."
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
state_file="$data_root/state.json"
new_install_at_launch=0
if [[ ! -f "$env_file" && ! -f "$data_root/contentbox.db" && ! -f "$state_file" ]]; then
  new_install_at_launch=1
fi

mkdir -p "$data_root" "$config_dir" "$state_dir" "$log_dir"
launcher_lock_dir="$state_dir/launcher.lock"

is_launcher_process() {
  local pid="$1"
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$script_dir/start.sh"* ]]
}

acquire_launcher_lock() {
  local deadline owner
  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if mkdir "$launcher_lock_dir" >/dev/null 2>&1; then
      printf '%s\n' "$$" >"$launcher_lock_dir/owner"
      launcher_lock_held=1
      return 0
    fi
    owner=""
    if [[ -f "$launcher_lock_dir/owner" ]]; then
      owner="$(tr -dc '0-9' <"$launcher_lock_dir/owner" || true)"
    fi
    if [[ -z "$owner" ]] || ! kill -0 "$owner" >/dev/null 2>&1 || ! is_launcher_process "$owner"; then
      rm -f "$launcher_lock_dir/owner"
      rmdir "$launcher_lock_dir" >/dev/null 2>&1 || true
      continue
    fi
    sleep 0.25
  done
  fail "Another Certifyd Core launch is still in progress. Try again in a moment."
}

acquire_launcher_lock

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

lan_opt_in_file="$state_dir/lan-enabled"
if [[ "$CONTENTBOX_PRIVATE_BIND" == "public" || -f "$lan_opt_in_file" ]]; then
  LAN_MODE=1
fi
if [[ "$LAN_MODE" -eq 1 ]]; then
  : >"$lan_opt_in_file"
  lan_hosts="$(detect_lan_hosts)"
  lan_primary_host="${lan_hosts%%,*}"
  previous_launcher_hosts="$(cat "$state_dir/launcher-lan-hosts.txt" 2>/dev/null || true)"
  preserved_hosts="$(subtract_host_lists "${CONTENTBOX_PRIVATE_ALLOWED_HOSTS:-}" "$previous_launcher_hosts")"
  export CONTENTBOX_PRIVATE_BIND="public"
  if [[ -n "$lan_hosts" ]]; then
    export CONTENTBOX_PRIVATE_ALLOWED_HOSTS="$(merge_host_lists "$preserved_hosts" "$lan_hosts")"
    export APP_BASE_URL="http://$lan_primary_host:$PORT"
    printf '%s\n' "$lan_hosts" >"$state_dir/launcher-lan-hosts.txt"
    echo "[Certifyd Core] LAN dashboard: $APP_BASE_URL"
  else
    export CONTENTBOX_PRIVATE_BIND="local"
    export CONTENTBOX_PRIVATE_ALLOWED_HOSTS="$preserved_hosts"
    export APP_BASE_URL="http://127.0.0.1:$PORT"
    echo "[Certifyd Core] WARNING: no LAN IP detected; set CONTENTBOX_PRIVATE_ALLOWED_HOSTS manually if needed." >&2
  fi
fi
if [[ "$FIRST_RUN_QUICK" -eq 1 && "$new_install_at_launch" -eq 1 ]]; then
  export PUBLIC_MODE="quick"
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
if [[ "$FIRST_RUN_QUICK" -eq 1 && "$new_install_at_launch" -eq 1 && ! -f "$state_file" ]]; then
  "$node_bin" -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      publicSharingConsent: { granted: true, dontAskAgain: true, grantedAt: new Date().toISOString() },
      publicSharingAutoStart: true
    }, null, 2));
  ' "$state_file"
fi

app_version="development"
[[ -f "$app_dir/app-version.txt" ]] && app_version="$(tr -d '\r\n' <"$app_dir/app-version.txt")"
database_prepared_marker="$state_dir/database-prepared-version.txt"
prepared_version=""
[[ -f "$database_prepared_marker" ]] && prepared_version="$(tr -d '\r\n' <"$database_prepared_marker")"
configured_db_path=""
case "$DATABASE_URL" in
  file:*)
    configured_db_path="${DATABASE_URL#file:}"
    case "$configured_db_path" in
      /*) ;;
      *) configured_db_path="$api_dir/$configured_db_path" ;;
    esac
    ;;
esac

backup_sqlite_for_upgrade() {
  local source="$1" version="$2" safe_version stamp backup_dir companion
  [[ -n "$source" && -s "$source" ]] || return 0
  safe_version="$(printf '%s' "$version" | tr -c 'A-Za-z0-9._-' '_')"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="$CONTENTBOX_ROOT/backups/pre-upgrade/$stamp-$safe_version"
  mkdir -p "$backup_dir"
  for companion in "$source" "$source-wal" "$source-shm"; do
    [[ -f "$companion" ]] && cp -p "$companion" "$backup_dir/"
  done
  cat >"$backup_dir/RECOVERY.txt" <<EOF
Certifyd Core pre-upgrade recovery point
Application version: $version
Database path: $source

Keep Core stopped before restoring this database and its matching -wal/-shm
files. Use View Logs or Certifyd support if preparation failed.
EOF
  printf '%s\n' "$backup_dir" >"$state_dir/last-database-backup.txt"
  last_upgrade_backup="$backup_dir"
  set_launcher_status "Backed up local data before the update."
}

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
  if [[ "${CERTIFYD_NO_BROWSER:-}" == "1" ]]; then
    return 0
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$app_url" >/dev/null 2>&1 || fail "Core is running at $app_url, but Linux could not open the dashboard. Open that address in your browser."
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$app_url" >/dev/null 2>&1 || fail "Core is running at $app_url, but Linux could not open the dashboard. Open that address in your browser."
  else
    fail "Core is running at $app_url, but no desktop browser opener is available. Open that address in your browser."
  fi
}

is_core_process() {
  local pid="$1"
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$node_bin"* && "$command" == *"src/server.ts"* ]]
}

any_core_process() {
  ps -ax -o command= 2>/dev/null | awk -v node="$node_bin" '
    index($0, node) && $0 ~ /src\/server\.ts/ { found=1 }
    END { exit(found ? 0 : 1) }
  '
}

wait_for_core_health() {
  local seconds="$1"
  local pid="${2:-}"
  local deadline
  deadline=$((SECONDS + seconds))
  while (( SECONDS < deadline )); do
    if check_health; then
      return 0
    fi
    if [[ -n "$pid" ]] && { ! kill -0 "$pid" >/dev/null 2>&1 || ! is_core_process "$pid"; }; then
      return 1
    fi
    sleep 0.75
  done
  return 1
}

if check_health; then
  set_launcher_status "Core is already running. Opening the dashboard..."
  open_browser
  close_launcher_splash
  exit 0
fi

if [[ -f "$pid_file" ]]; then
  existing_pid="$(tr -dc '0-9' <"$pid_file" || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1 && is_core_process "$existing_pid"; then
    set_launcher_status "Waiting for the existing Core process..."
    if wait_for_core_health 45 "$existing_pid"; then
      set_launcher_status "Core is ready. Opening the dashboard..."
      open_browser
      close_launcher_splash
      exit 0
    fi
    fail "Core is running but did not become ready. Logs are in $log_dir"
  fi
  rm -f "$pid_file"
fi

if [[ "${CERTIFYD_NO_BROWSER:-}" != "1" ]] && command -v notify-send >/dev/null 2>&1; then
  notify-send "Certifyd Core" "Starting the local dashboard..." >/dev/null 2>&1 || true
fi

if [[ "$prepared_version" != "$app_version" || ( -n "$configured_db_path" && ! -f "$configured_db_path" ) ]]; then
  if any_core_process; then
    fail "A Certifyd Core process is still using the database. Stop it before applying this update."
  fi
  last_upgrade_backup=""
  backup_sqlite_for_upgrade "$configured_db_path" "$app_version"
  if [[ -n "$configured_db_path" && ! -f "$configured_db_path" ]]; then
    mkdir -p "$(dirname "$configured_db_path")"
    : >"$configured_db_path"
  fi
  set_launcher_status "Validating local data..."
  if ! (
    cd "$api_dir"
    "$node_bin" "$prisma_cli" validate --schema "$schema_path"
    if [[ ! -d "$api_dir/node_modules/.prisma/client" ]]; then
      set_launcher_status "Preparing the local database client..."
      "$node_bin" "$prisma_cli" generate --schema "$schema_path"
    fi
    set_launcher_status "Applying local database updates..."
    "$node_bin" "$prisma_cli" db push --schema "$schema_path" --skip-generate
  ); then
    recovery_hint="${last_upgrade_backup:-No pre-update database existed.}"
    fail "Local database preparation failed. Core was not started. Recovery point: $recovery_hint"
  fi
  printf '%s\n' "$app_version" >"$database_prepared_marker.tmp"
  mv "$database_prepared_marker.tmp" "$database_prepared_marker"
fi

if check_health; then
  set_launcher_status "Core became ready while preparing. Opening the dashboard..."
  open_browser
  close_launcher_splash
  exit 0
fi

set_launcher_status "Starting the Certifyd Core service..."
(
  cd "$api_dir"
  nohup "$node_bin" --import tsx src/server.ts >"$stdout_log" 2>"$stderr_log" &
  echo "$!" >"$pid_file"
)

started_pid="$(tr -dc '0-9' <"$pid_file" || true)"
set_launcher_status "Waiting for the dashboard to become ready..."
if [[ -n "$started_pid" ]] && wait_for_core_health 45 "$started_pid"; then
  set_launcher_status "Core is ready. Opening the dashboard..."
  open_browser
  close_launcher_splash
  exit 0
fi

if [[ -n "$started_pid" ]] && ! kill -0 "$started_pid" >/dev/null 2>&1; then
  rm -f "$pid_file"
fi

echo "[Certifyd Core] Core did not become ready. Logs:" >&2
echo "  $stdout_log" >&2
echo "  $stderr_log" >&2
tail -n 80 "$stderr_log" >&2 || true
fail "Core did not become ready. Logs are in $log_dir"
