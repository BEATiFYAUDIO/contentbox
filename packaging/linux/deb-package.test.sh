#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 package.deb x64|arm64 version" >&2
  exit 2
fi
package="$1"
target_arch="$2"
version="$3"
case "$target_arch" in
  x64) deb_arch=amd64 ;;
  arm64) deb_arch=arm64 ;;
  *) exit 2 ;;
esac
deb_version="${version/-beta./~beta.}"
[[ "$(dpkg-deb -f "$package" Package)" == certifyd-core ]]
[[ "$(dpkg-deb -f "$package" Version)" == "$deb_version" ]]
[[ "$(dpkg-deb -f "$package" Architecture)" == "$deb_arch" ]]

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
dpkg-deb -x "$package" "$root"
dpkg-deb -e "$package" "$root/control"
app="$root/opt/certifyd-core"
desktop="$root/usr/share/applications/certifyd-core.desktop"
icon="$root/usr/share/icons/hicolor/512x512/apps/certifyd-core.png"
[[ "$(cat "$app/app-version.txt")" == "$version" ]]
for executable in start.sh stop.sh control.sh tray.sh runtime/node/bin/node; do
  [[ -x "$app/$executable" ]]
done
[[ -f "$app/apps/api/prisma/schema.prisma" ]]
[[ -f "$app/apps/dashboard/dist/index.html" ]]
[[ -f "$app/tray.py" ]]
[[ -f "$root/usr/share/doc/certifyd-core/copyright" ]]
cmp "$app/assets/certifyd-core.png" "$icon"
grep -Fxq 'Exec=/opt/certifyd-core/tray.sh' "$desktop"
grep -Fxq 'Icon=certifyd-core' "$desktop"
grep -Fxq 'Terminal=false' "$desktop"
grep -Fxq 'Exec=/opt/certifyd-core/control.sh stop' "$desktop"
[[ ! -e "$root/control/postinst" && ! -e "$root/control/prerm" && ! -e "$root/control/postrm" ]]
[[ ! -e "$root/usr/bin/cloudflared" && ! -e "$root/lib/systemd/system/certifyd-core.service" ]]
[[ ! -e "$root/home" && ! -e "$root/var/lib/certifyd-core" ]]
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop"
fi
echo "Debian package metadata, contents, desktop entry, icon and data isolation: passed"
