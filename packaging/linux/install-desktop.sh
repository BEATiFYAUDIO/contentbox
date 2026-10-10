#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="${XDG_DATA_HOME:-"$HOME/.local/share"}/applications"
desktop_file="$desktop_dir/certifyd-core.desktop"
lan_desktop_file="$desktop_dir/certifyd-core-lan.desktop"
icon_path="$script_dir/assets/certifyd-core.png"

mkdir -p "$desktop_dir"
cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Certifyd Core
Comment=Launch Certifyd Core local dashboard
Exec="$script_dir/start.sh"
Icon=$icon_path
Terminal=false
Categories=Utility;
EOF

chmod +x "$desktop_file"
echo "[Certifyd Core] Desktop launcher installed: $desktop_file"

cat >"$lan_desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Certifyd Core (LAN Access)
Comment=Launch Certifyd Core for access from devices on your local network
Exec="$script_dir/start.sh" --lan
Icon=$icon_path
Terminal=false
Categories=Utility;
EOF

chmod +x "$lan_desktop_file"
echo "[Certifyd Core] LAN desktop launcher installed: $lan_desktop_file"
