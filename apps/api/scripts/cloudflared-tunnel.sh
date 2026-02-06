#!/usr/bin/env bash
set -euo pipefail

API_URL="${CONTENTBOX_TUNNEL_TARGET:-http://127.0.0.1:4000}"
LOG_PATH="${CONTENTBOX_TUNNEL_LOG:-/tmp/cloudflared-tunnel.log}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found in PATH" | tee -a "$LOG_PATH"
  exit 1
fi

while true; do
  echo "[$(date -Is)] starting cloudflared tunnel to $API_URL" | tee -a "$LOG_PATH"
  cloudflared tunnel --url "$API_URL" | tee -a "$LOG_PATH"
  echo "[$(date -Is)] cloudflared exited; restarting in 2s" | tee -a "$LOG_PATH"
  sleep 2
 done
