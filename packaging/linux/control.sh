#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_root="${CONTENTBOX_ROOT:-${XDG_DATA_HOME:-"$HOME/.local/share"}/contentbox}"
env_file="$data_root/config/api.env"
state_file="$data_root/state.json"
db_file="$data_root/contentbox.db"
logs="$data_root/logs"

read_env() {
  local key="$1" fallback="$2" value=""
  if [[ -f "$env_file" ]]; then
    value="$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  fi
  printf '%s\n' "${value:-$fallback}"
}

ask() {
  local text="$1"
  command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] &&
    zenity --question --title="Certifyd Core" --text="$text" --width=440 \
      --window-icon="$script_dir/assets/certifyd-core.png" 2>/dev/null
}

case "${1:-start}" in
  open)
    url="$(read_env APP_BASE_URL http://127.0.0.1:4000)"
    exec xdg-open "$url"
    ;;
  logs)
    mkdir -p "$logs"
    exec xdg-open "$logs"
    ;;
  stop)
    exec "$script_dir/stop.sh"
    ;;
  restart)
    "$script_dir/stop.sh"
    exec "$0" start
    ;;
  lan)
    if ask "Allow authenticated access to Certifyd Core from devices on your trusted local network? Your system firewall may also need to allow TCP port 4000 on the private network."; then
      "$script_dir/stop.sh"
      exec "$script_dir/start.sh" --lan
    fi
    exit 0
    ;;
  start)
    args=()
    if [[ ! -f "$env_file" && ! -f "$db_file" && ! -f "$state_file" ]]; then
      if ask "Allow authenticated access to Certifyd Core from your phone and other devices on this trusted local network?"; then
        args+=(--lan)
      fi
      if ask "Create a temporary public creator link when Certifyd Core starts? This exposes only Core's public storefront routes, not the private dashboard."; then
        args+=(--first-run-quick)
      fi
    fi
    exec "$script_dir/start.sh" "${args[@]}"
    ;;
  *)
    echo "Usage: $0 [start|open|lan|restart|stop|logs]" >&2
    exit 2
    ;;
esac
