#!/usr/bin/env bash
set -euo pipefail

version="0.1.0-beta"
node_version="20.19.0"
target_arch=""
stage_only=0

usage() {
  cat <<USAGE
Usage: scripts/build-macos-package.sh --arch x64|arm64 [--version 0.1.0-beta] [--node-version 20.19.0] [--stage-only]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage-only)
      stage_only=1
      shift
      ;;
    --arch)
      target_arch="${2:-}"
      shift 2
      ;;
    --version)
      version="${2:-}"
      shift 2
      ;;
    --node-version)
      node_version="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[macos-package] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$target_arch" != "x64" && "$target_arch" != "arm64" ]]; then
  usage >&2
  exit 1
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[macos-package] Build macOS packages on macOS so native dependencies and Prisma engines are correct." >&2
  exit 1
fi

host_machine="$(uname -m)"
case "$target_arch:$host_machine" in
  x64:x86_64|arm64:arm64) ;;
  *)
    echo "[macos-package] Refusing to build $target_arch on host architecture $host_machine." >&2
    echo "[macos-package] Build on a native macOS $target_arch runner." >&2
    exit 1
    ;;
esac

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
read -r apple_short_version apple_build_version <<< "$(python3 "$repo_root/scripts/macos-release.py" versions --version "$version")"
test -n "$apple_short_version" && test -n "$apple_build_version"
dist_root="$repo_root/.dist/macos-$target_arch"
stage_root="$dist_root/stage"
cache_dir="$dist_root/cache"
package_dir="$dist_root/package"
dmg_root="$dist_root/dmg-root"
app_name="Certifyd Core.app"
bundle_root="$stage_root/$app_name"
contents_dir="$bundle_root/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"
app_stage="$resources_dir/app"
runtime_stage="$resources_dir/runtime"
assets_stage="$resources_dir/assets"
node_tar="$cache_dir/node-v$node_version-darwin-$target_arch.tar.gz"
node_url="https://nodejs.org/dist/v$node_version/node-v$node_version-darwin-$target_arch.tar.gz"

echo "[macos-package] Repo: $repo_root"
echo "[macos-package] Target: macos-$target_arch"
echo "[macos-package] Node: $node_version"

rm -rf "$stage_root" "$dmg_root"
mkdir -p "$cache_dir" "$package_dir" "$macos_dir" "$resources_dir" "$app_stage/apps/api" "$app_stage/apps/dashboard" "$runtime_stage" "$assets_stage"

if [[ ! -f "$node_tar" ]]; then
  echo "[macos-package] Downloading Node runtime: $node_url"
  curl -fsSL "$node_url" -o "$node_tar"
fi

tar -xzf "$node_tar" -C "$runtime_stage"
mv "$runtime_stage/node-v$node_version-darwin-$target_arch" "$runtime_stage/node"

node_bin="$runtime_stage/node/bin/node"
npm_bin="$runtime_stage/node/bin/npm"
"$node_bin" --version
"$npm_bin" --version

api_source="$repo_root/apps/api"
api_target="$app_stage/apps/api"
for item in package.json package-lock.json tsconfig.json src prisma scripts upgrade-advanced.ps1; do
  if [[ -e "$api_source/$item" ]]; then
    cp -a "$api_source/$item" "$api_target/$item"
  fi
done

dashboard_source="$repo_root/apps/dashboard"
dashboard_target="$app_stage/apps/dashboard"
for item in package.json package-lock.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html src public postcss.config.js tailwind.config.js; do
  if [[ -e "$dashboard_source/$item" ]]; then
    cp -a "$dashboard_source/$item" "$dashboard_target/$item"
  fi
done

cp "$repo_root/packaging/macos/CertifydCoreLauncher.sh" "$resources_dir/CertifydCoreLauncher.sh"
launcher_arch="$target_arch"
if [[ "$target_arch" == "x64" ]]; then launcher_arch="x86_64"; fi
xcrun clang -arch "$launcher_arch" -mmacosx-version-min=12.0 -Os -Wall -Wextra -Werror \
  "$repo_root/packaging/macos/CertifydCoreLauncher.c" -o "$macos_dir/CertifydCoreLauncher"
cp "$repo_root/packaging/macos/stop.sh" "$resources_dir/stop.sh"
cp "$repo_root/packaging/macos/status.sh" "$resources_dir/status.sh"
cp "$repo_root/packaging/macos/README.txt" "$resources_dir/README.txt"
chmod +x "$macos_dir/CertifydCoreLauncher" "$resources_dir/stop.sh" "$resources_dir/status.sh"

icon_source="$repo_root/apps/dashboard/src/assets/certifyd_icon_logo_only.svg"
icon_icns="$resources_dir/CertifydCore.icns"
if [[ -f "$icon_source" ]]; then
  iconset="$dist_root/CertifydCore.iconset"
  icon_png="$dist_root/CertifydCore.source.png"
  rm -rf "$iconset"
  mkdir -p "$iconset"
  sips -s format png "$icon_source" --out "$icon_png" >/dev/null
  sips -z 16 16 "$icon_png" --out "$iconset/icon_16x16.png" >/dev/null
  sips -z 32 32 "$icon_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$icon_png" --out "$iconset/icon_32x32.png" >/dev/null
  sips -z 64 64 "$icon_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$icon_png" --out "$iconset/icon_128x128.png" >/dev/null
  sips -z 256 256 "$icon_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$icon_png" --out "$iconset/icon_256x256.png" >/dev/null
  sips -z 512 512 "$icon_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$icon_png" --out "$iconset/icon_512x512.png" >/dev/null
  cp "$icon_png" "$assets_stage/certifyd-core.png"
  cp "$icon_source" "$assets_stage/certifyd-core.svg"
  iconutil -c icns "$iconset" -o "$icon_icns"
fi

cat >"$contents_dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Certifyd Core</string>
  <key>CFBundleExecutable</key>
  <string>CertifydCoreLauncher</string>
  <key>CFBundleIconFile</key>
  <string>CertifydCore</string>
  <key>CFBundleIdentifier</key>
  <string>me.certifyd.core</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Certifyd Core</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$apple_short_version</string>
  <key>CFBundleVersion</key>
  <string>$apple_build_version</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "APPL????" > "$contents_dir/PkgInfo"

echo "[macos-package] Installing API dependencies into staging..."
"$npm_bin" --prefix "$api_target" ci

echo "[macos-package] Generating macOS Prisma client..."
api_schema="$api_target/prisma/schema.prisma"
package_db="$api_target/contentbox-package-build.db"
export DATABASE_URL="file:$package_db"
"$npm_bin" --prefix "$api_target" exec -- prisma validate --schema "$api_schema"
"$npm_bin" --prefix "$api_target" exec -- prisma generate --schema "$api_schema"
rm -f "$package_db"

echo "[macos-package] Installing dashboard dependencies into staging..."
"$npm_bin" --prefix "$dashboard_target" ci
echo "[macos-package] Building dashboard..."
"$npm_bin" --prefix "$dashboard_target" run build
rm -rf "$dashboard_target/node_modules"

checks=(
  "$node_bin"
  "$api_target/node_modules/tsx"
  "$api_target/node_modules/prisma/build/index.js"
  "$api_target/node_modules/.prisma/client"
  "$api_target/prisma/schema.prisma"
  "$dashboard_target/dist/index.html"
  "$macos_dir/CertifydCoreLauncher"
  "$contents_dir/Info.plist"
)
for check in "${checks[@]}"; do
  if [[ ! -e "$check" ]]; then
    echo "[macos-package] Missing expected packaged artifact: $check" >&2
    exit 1
  fi
done

if ! find "$api_target/node_modules/@prisma/engines" -type f -name '*darwin*' | grep -q .; then
  echo "[macos-package] Missing expected macOS Prisma engine artifacts." >&2
  exit 1
fi

python3 "$repo_root/scripts/macos-release.py" inventory "$bundle_root" --arch "$target_arch" --version "$version" > "$dist_root/macho-inventory.json"
if [[ "$stage_only" -eq 1 ]]; then
  echo "[macos-package] Staged app: $bundle_root"
  exit 0
fi

exec bash "$repo_root/scripts/create-macos-dmg.sh" "$target_arch" "$version"
