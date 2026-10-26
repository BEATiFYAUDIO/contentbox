#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="${XDG_DATA_HOME:-"$HOME/.local/share"}/applications"
desktop_file="$desktop_dir/certifyd-core.desktop"
icon_path="$script_dir/assets/certifyd-core.png"

mkdir -p "$desktop_dir"
cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Certifyd Core
Comment=Launch Certifyd Core local dashboard
Exec="$script_dir/tray.sh"
Icon=$icon_path
Terminal=false
Categories=Utility;
Actions=Open;Start;LAN;Restart;Stop;Logs;

[Desktop Action Open]
Name=Open Dashboard
Exec="$script_dir/control.sh" open

[Desktop Action Start]
Name=Start Core
Exec="$script_dir/control.sh" start

[Desktop Action LAN]
Name=Enable or Refresh LAN Access
Exec="$script_dir/control.sh" lan

[Desktop Action Restart]
Name=Restart Core
Exec="$script_dir/control.sh" restart

[Desktop Action Stop]
Name=Stop Core
Exec="$script_dir/control.sh" stop

[Desktop Action Logs]
Name=View Logs
Exec="$script_dir/control.sh" logs
EOF

chmod +x "$desktop_file"
echo "[Certifyd Core] Desktop launcher installed: $desktop_file"
rm -f "$desktop_dir/certifyd-core-lan.desktop"
