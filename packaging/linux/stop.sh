#!/usr/bin/env bash
set -euo pipefail

data_root="${CONTENTBOX_ROOT:-"${XDG_DATA_HOME:-"$HOME/.local/share"}/contentbox"}"
pid_file="$data_root/state/certifyd-core.pid"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node_bin="$script_dir/runtime/node/bin/node"

is_core_process() {
  local pid="$1"
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$node_bin"* && "$command" == *"src/server.ts"* ]]
}

if [[ ! -f "$pid_file" ]]; then
  echo "[Certifyd Core] No runtime pid file found."
  exit 0
fi

process_id="$(tr -dc '0-9' <"$pid_file" || true)"
if [[ -z "$process_id" ]]; then
  rm -f "$pid_file"
  echo "[Certifyd Core] Removed invalid pid file."
  exit 0
fi

if ! kill -0 "$process_id" >/dev/null 2>&1; then
  rm -f "$pid_file"
  echo "[Certifyd Core] Runtime is not running."
  exit 0
fi

if ! is_core_process "$process_id"; then
  rm -f "$pid_file"
  echo "[Certifyd Core] Removed stale pid file; the process is not this Certifyd Core runtime."
  exit 0
fi

kill "$process_id" >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  if ! kill -0 "$process_id" >/dev/null 2>&1; then
    rm -f "$pid_file"
    echo "[Certifyd Core] Stopped."
    exit 0
  fi
  sleep 0.25
done

kill -9 "$process_id" >/dev/null 2>&1 || true
rm -f "$pid_file"
echo "[Certifyd Core] Stopped."
