#!/usr/bin/env bash
set -euo pipefail

fail() {
  osascript -e "display alert \"Certifyd Core\" message \"$*\" as critical" >/dev/null 2>&1 || true
  echo "[Certifyd Core] $*" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
resources_dir="$(cd -- "$script_dir/.." && pwd)"
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
append_config_if_missing "CONTENTBOX_BIND" "$CONTENTBOX_BIND"
append_config_if_missing "PUBLIC_MODE" "$PUBLIC_MODE"
append_config_if_missing "PORT" "$PORT"
append_config_if_missing "APP_BASE_URL" "$APP_BASE_URL"

if [[ ! -f "$db_path" ]]; then
  : >"$db_path"
fi

health_url="http://127.0.0.1:$PORT/health"
app_url="http://127.0.0.1:$PORT"

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
