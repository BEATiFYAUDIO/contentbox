#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${ROOT_DIR}/apps/api"
LOCK_FILE="${HOME}/contentbox-data/state/api-runtime.lock.json"

if [[ -f "${LOCK_FILE}" ]]; then
  existing_pid="$(grep -E '"pid"' "${LOCK_FILE}" | head -n1 | sed -E 's/[^0-9]*([0-9]+).*/\1/' || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" >/dev/null 2>&1; then
    echo "[dev-api] API appears to already be running (pid ${existing_pid})."
    echo "[dev-api] Reusing existing runtime; not starting another watcher."
    exit 0
  fi
fi

if curl -fsS "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
  echo "[dev-api] API health endpoint already responding on :4000."
  echo "[dev-api] Reusing existing runtime; not starting another watcher."
  exit 0
fi

cd "${API_DIR}"
exec npm run dev
