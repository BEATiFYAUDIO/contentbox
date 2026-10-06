#!/usr/bin/env bash
# Build the same DMG from an already staged (optionally signed) app. No rebuild.
set -euo pipefail
target_arch="${1:?architecture required}"
version="${2:?version required}"
[[ "$target_arch" == x64 || "$target_arch" == arm64 ]] || exit 1
[[ "$(uname -s)" == Darwin ]] || exit 1
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$repo_root/scripts/macos-release.py" versions --version "$version" >/dev/null
dist_root="$repo_root/.dist/macos-$target_arch"
bundle_root="$dist_root/stage/Certifyd Core.app"
package_dir="$dist_root/package"
dmg_root="$dist_root/dmg-root"
app_name="Certifyd Core.app"
test -d "$bundle_root"
rm -rf "$dmg_root"
mkdir -p "$package_dir"

mkdir -p "$dmg_root"
cp -R "$bundle_root" "$dmg_root/$app_name"
ln -s /Applications "$dmg_root/Applications"
cp "$repo_root/packaging/macos/README.txt" "$dmg_root/README.txt"
cat >"$dmg_root/Start Certifyd Core with LAN Access.command" <<'COMMAND'
#!/bin/bash
set -euo pipefail

app_path="/Applications/Certifyd Core.app"
if [[ ! -x "$app_path/Contents/MacOS/CertifydCoreLauncher" ]]; then
  script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
  app_path="$script_dir/Certifyd Core.app"
fi

if [[ ! -x "$app_path/Contents/MacOS/CertifydCoreLauncher" ]]; then
  osascript -e 'display alert "Certifyd Core" message "Install Certifyd Core in Applications, or run this helper from the Certifyd Core disk image." as critical' >/dev/null 2>&1 || true
  echo "Certifyd Core.app was not found." >&2
  exit 1
fi

"$app_path/Contents/MacOS/CertifydCoreLauncher" --lan
COMMAND
chmod +x "$dmg_root/Start Certifyd Core with LAN Access.command"

dmg_name="Certifyd-Core-$version-macos-$target_arch.dmg"
dmg_path="$package_dir/$dmg_name"
rm -f "$dmg_path" "$dmg_path.sha256"
hdiutil create -volname "Certifyd Core" -srcfolder "$dmg_root" -ov -format UDZO "$dmg_path"
shasum -a 256 "$dmg_path" | tee "$dmg_path.sha256"

echo "[macos-package] Done."
echo "[macos-package] Package: $dmg_path"
