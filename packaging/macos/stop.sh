#!/usr/bin/env bash
set -euo pipefail

data_root="${CONTENTBOX_ROOT:-"$HOME/Library/Application Support/ContentBox"}"
pid_file="$data_root/state/certifyd-core.pid"

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
