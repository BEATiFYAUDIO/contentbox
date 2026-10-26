#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 staged-app x64|arm64 version output-dir" >&2
  exit 2
fi

app_stage="$1"
target_arch="$2"
version="$3"
output_dir="$4"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

case "$target_arch" in
  x64) deb_arch=amd64 ;;
  arm64) deb_arch=arm64 ;;
  *) echo "Unsupported Linux architecture: $target_arch" >&2; exit 2 ;;
esac
if [[ ! "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]]; then
  echo "Expected a numbered beta version, got: $version" >&2
  exit 2
fi
deb_version="${BASH_REMATCH[1]}~beta.${BASH_REMATCH[2]}"
[[ -x "$app_stage/start.sh" && -x "$app_stage/runtime/node/bin/node" ]] || {
  echo "Missing staged Certifyd Core runtime" >&2
  exit 1
}
[[ "$(cat "$app_stage/app-version.txt")" == "$version" ]] || {
  echo "Staged application version does not match $version" >&2
  exit 1
}

deb_root="$(mktemp -d)"
trap 'rm -rf "$deb_root"' EXIT
app_dir="$deb_root/opt/certifyd-core"
mkdir -p "$app_dir" "$deb_root/DEBIAN" \
  "$deb_root/usr/share/applications" \
  "$deb_root/usr/share/icons/hicolor/512x512/apps" \
  "$deb_root/usr/share/doc/certifyd-core"
cp -a "$app_stage/." "$app_dir/"
cp "$app_stage/assets/certifyd-core.png" \
  "$deb_root/usr/share/icons/hicolor/512x512/apps/certifyd-core.png"
cp "$repo_root/LICENSE" "$deb_root/usr/share/doc/certifyd-core/copyright"

cat >"$deb_root/usr/share/applications/certifyd-core.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Certifyd Core
Comment=Open the Certifyd Core dashboard and controls
Exec=/opt/certifyd-core/tray.sh
Icon=certifyd-core
Terminal=false
Categories=Utility;
Actions=Open;Start;LAN;Restart;Stop;Logs;

[Desktop Action Open]
Name=Open Dashboard
Exec=/opt/certifyd-core/control.sh open

[Desktop Action Start]
Name=Start Core
Exec=/opt/certifyd-core/control.sh start

[Desktop Action LAN]
Name=Enable or Refresh LAN Access
Exec=/opt/certifyd-core/control.sh lan

[Desktop Action Restart]
Name=Restart Core
Exec=/opt/certifyd-core/control.sh restart

[Desktop Action Stop]
Name=Stop Core
Exec=/opt/certifyd-core/control.sh stop

[Desktop Action Logs]
Name=View Logs
Exec=/opt/certifyd-core/control.sh logs
DESKTOP

installed_size="$(du -sk "$deb_root/opt" "$deb_root/usr" | awk '{sum += $1} END {print sum}')"
cat >"$deb_root/DEBIAN/control" <<CONTROL
Package: certifyd-core
Version: $deb_version
Architecture: $deb_arch
Maintainer: Beatify Group Inc.
Section: utils
Priority: optional
Installed-Size: $installed_size
Homepage: https://certifyd.me/
Description: Certifyd Core creator application
 Local creator dashboard and public creator page with an optional desktop
 tray. The application includes its own runtime. User data remains in the
 creator's home directory and public sharing requires authorization.
CONTROL

mkdir -p "$output_dir"
package="$output_dir/Certifyd-Core-$version-linux-$target_arch.deb"
dpkg-deb --build --root-owner-group "$deb_root" "$package"
sha256sum "$package" >"$package.sha256"
echo "[linux-deb] Package: $package"
