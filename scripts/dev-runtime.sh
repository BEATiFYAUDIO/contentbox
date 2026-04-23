#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${HOME}/contentbox-data/state"
LOG_DIR="${HOME}/contentbox-data/logs"
API_PID_FILE="${STATE_DIR}/dev-api.pid"
DASH_PID_FILE="${STATE_DIR}/dev-dashboard.pid"
API_LOG="${LOG_DIR}/api-dev.log"
DASH_LOG="${LOG_DIR}/dashboard-dev.log"
API_URL="http://127.0.0.1:4000/health"
DASH_URL="http://localhost:5173"

mkdir -p "${STATE_DIR}" "${LOG_DIR}"

is_pid_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1
}

read_pid_file() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  tr -dc '0-9' < "${file}"
}

write_pid_file() {
  local file="$1"
  local pid="$2"
  printf "%s\n" "${pid}" > "${file}"
}

rm_pid_file_if_dead() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    local pid
    pid="$(read_pid_file "${file}" || true)"
    if [[ -z "${pid}" ]] || ! is_pid_alive "${pid}"; then
      rm -f "${file}"
    fi
  fi
}

kill_pid_from_file() {
  local file="$1"
  local name="$2"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi
  local pid
  pid="$(read_pid_file "${file}" || true)"
  if [[ -n "${pid}" ]] && is_pid_alive "${pid}"; then
    echo "[dev-runtime] Stopping ${name} (pid ${pid})"
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! is_pid_alive "${pid}"; then
        break
      fi
      sleep 0.2
    done
    if is_pid_alive "${pid}"; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "${file}"
}

kill_stale_repo_processes() {
  local matches
  matches="$(ps -eo pid=,cmd= | awk -v root="${ROOT_DIR}" '
    $0 ~ root && ($0 ~ /apps\/api/ || $0 ~ /apps\/dashboard/ || $0 ~ /vite/ || $0 ~ /tsx watch/) { print $1 }
  ')"
  if [[ -n "${matches}" ]]; then
    echo "[dev-runtime] Cleaning stale repo processes: ${matches//$'\n'/ }"
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      kill "${pid}" >/dev/null 2>&1 || true
    done <<< "${matches}"
    sleep 0.6
  fi
}

wait_for_url() {
  local url="$1"
  local timeout_secs="$2"
  local name="$3"
  local elapsed=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if (( elapsed >= timeout_secs )); then
      echo "[dev-runtime] ${name} did not become ready in ${timeout_secs}s"
      return 1
    fi
  done
  echo "[dev-runtime] ${name} ready: ${url}"
}

start_api() {
  rm_pid_file_if_dead "${API_PID_FILE}"
  local existing
  existing="$(read_pid_file "${API_PID_FILE}" || true)"
  if [[ -n "${existing}" ]] && is_pid_alive "${existing}"; then
    echo "[dev-runtime] API already running (pid ${existing})"
    return 0
  fi
  if curl -fsS "${API_URL}" >/dev/null 2>&1; then
    echo "[dev-runtime] API already responding on :4000"
    return 0
  fi
  echo "[dev-runtime] Starting API watcher"
  (cd "${ROOT_DIR}" && nohup npm run dev:api > "${API_LOG}" 2>&1 & echo $! > "${API_PID_FILE}")
  wait_for_url "${API_URL}" 45 "API" || {
    echo "[dev-runtime] API log tail:"
    tail -n 60 "${API_LOG}" || true
    return 1
  }
}

start_dashboard() {
  rm_pid_file_if_dead "${DASH_PID_FILE}"
  local existing
  existing="$(read_pid_file "${DASH_PID_FILE}" || true)"
  if [[ -n "${existing}" ]] && is_pid_alive "${existing}"; then
    echo "[dev-runtime] Dashboard already running (pid ${existing})"
    return 0
  fi
  if curl -fsS "${DASH_URL}" >/dev/null 2>&1; then
    echo "[dev-runtime] Dashboard already responding on :5173"
    return 0
  fi
  echo "[dev-runtime] Starting dashboard watcher"
  (cd "${ROOT_DIR}" && nohup npm --prefix apps/dashboard run dev -- --host 0.0.0.0 --port 5173 > "${DASH_LOG}" 2>&1 & echo $! > "${DASH_PID_FILE}")
  wait_for_url "${DASH_URL}" 45 "Dashboard" || {
    echo "[dev-runtime] Dashboard log tail:"
    tail -n 60 "${DASH_LOG}" || true
    return 1
  }
}

show_status() {
  rm_pid_file_if_dead "${API_PID_FILE}"
  rm_pid_file_if_dead "${DASH_PID_FILE}"
  local api_pid dash_pid
  api_pid="$(read_pid_file "${API_PID_FILE}" || true)"
  dash_pid="$(read_pid_file "${DASH_PID_FILE}" || true)"

  echo "[dev-runtime] API pid: ${api_pid:-none}"
  echo "[dev-runtime] Dashboard pid: ${dash_pid:-none}"
  if curl -fsS "${API_URL}" >/dev/null 2>&1; then
    echo "[dev-runtime] API health: UP"
  else
    echo "[dev-runtime] API health: DOWN"
  fi
  if curl -fsS "${DASH_URL}" >/dev/null 2>&1; then
    echo "[dev-runtime] Dashboard: UP"
  else
    echo "[dev-runtime] Dashboard: DOWN"
  fi
  echo "[dev-runtime] Watchers on ports:"
  ss -ltnp 2>/dev/null | rg -n ":(4000|5173)\\b|LISTEN" || true
}

stop_all() {
  kill_pid_from_file "${DASH_PID_FILE}" "Dashboard"
  kill_pid_from_file "${API_PID_FILE}" "API"
  kill_stale_repo_processes
}

start_all() {
  stop_all
  start_api
  start_dashboard
  show_status
}

usage() {
  cat <<USAGE
Usage: scripts/dev-runtime.sh [start|stop|restart|status]
USAGE
}

cmd="${1:-start}"
case "${cmd}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    show_status
    ;;
  restart)
    start_all
    ;;
  status)
    show_status
    ;;
  *)
    usage
    exit 1
    ;;
esac
