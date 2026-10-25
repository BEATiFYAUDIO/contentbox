#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
launcher_source="${CERTIFYD_LAUNCHER_SOURCE:-$script_dir/start.sh}"

# Exercise the launcher's real functions under its strict shell settings.
source <(awk '
  /^normalize_host_list\(\) \{/ { copying = 1 }
  /^detect_primary_lan_host\(\) \{/ { exit }
  copying { print }
' "$launcher_source")

check() {
  local label="$1" expected="$2" existing="$3" removed="$4" actual
  actual="$(subtract_host_lists "$existing" "$removed")"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected <%s>, got <%s>\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

check empty '' '' '192.168.1.5'
check fully_removed '' '192.168.1.5,10.0.0.5' '192.168.1.5,10.0.0.5'
check retain_manual 'core.example.com' 'core.example.com,192.168.1.5' '192.168.1.5'
check changed_lan '192.168.1.9' '192.168.1.9,192.168.1.5' '192.168.1.5'

echo 'Linux launcher LAN host-list regression: passed'
