#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  for python_bin in "$(command -v python3 || true)" /usr/bin/python3; do
    if [[ -x "$python_bin" ]] && "$python_bin" -c 'import gi; gi.require_version("Gtk", "3.0")' >/dev/null 2>&1; then
      exec "$python_bin" "$script_dir/tray.py"
    fi
  done
fi
exec "$script_dir/control.sh" start
