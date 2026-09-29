#!/usr/bin/env bash
set -euo pipefail

version="0.1.0-beta"
node_version="20.19.0"
target_arch=""

usage() {
  cat <<USAGE
Usage: scripts/build-linux-package.sh --arch x64|arm64 [--version 0.1.0-beta] [--node-version 20.19.0]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
      echo "[linux-package] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$target_arch" != "x64" && "$target_arch" != "arm64" ]]; then
  usage >&2
  exit 1
fi

host_machine="$(uname -m)"
case "$target_arch:$host_machine" in
  x64:x86_64|arm64:aarch64|arm64:arm64) ;;
  *)
    echo "[linux-package] Refusing to build $target_arch on host architecture $host_machine." >&2
    echo "[linux-package] Build on a native Linux $target_arch host so node_modules and Prisma engines are platform-correct." >&2
    exit 1
    ;;
esac

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dist_root="$repo_root/.dist/linux-$target_arch"
stage_root="$dist_root/stage"
cache_dir="$dist_root/cache"
package_dir="$dist_root/package"
app_stage="$stage_root/Certifyd-Core-$version-linux-$target_arch"
runtime_stage="$app_stage/runtime"
assets_stage="$app_stage/assets"
node_tar="$cache_dir/node-v$node_version-linux-$target_arch.tar.xz"
node_url="https://nodejs.org/dist/v$node_version/node-v$node_version-linux-$target_arch.tar.xz"

echo "[linux-package] Repo: $repo_root"
echo "[linux-package] Target: linux-$target_arch"
echo "[linux-package] Node: $node_version"

rm -rf "$stage_root"
mkdir -p "$cache_dir" "$package_dir" "$app_stage/apps/api" "$app_stage/apps/dashboard" "$runtime_stage" "$assets_stage"

if [[ ! -f "$node_tar" ]]; then
  echo "[linux-package] Downloading Node runtime: $node_url"
  curl -fsSL "$node_url" -o "$node_tar"
fi

tar -xJf "$node_tar" -C "$runtime_stage"
mv "$runtime_stage/node-v$node_version-linux-$target_arch" "$runtime_stage/node"

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

cp "$repo_root/packaging/linux/start.sh" "$app_stage/start.sh"
cp "$repo_root/packaging/linux/stop.sh" "$app_stage/stop.sh"
cp "$repo_root/packaging/linux/status.sh" "$app_stage/status.sh"
cp "$repo_root/packaging/linux/install-desktop.sh" "$app_stage/install-desktop.sh"
cp "$repo_root/packaging/linux/README.md" "$app_stage/README.md"
chmod +x "$app_stage/start.sh" "$app_stage/stop.sh" "$app_stage/status.sh" "$app_stage/install-desktop.sh"

if [[ -f "$repo_root/apps/dashboard/public/certifyd-icon.png" ]]; then
  cp "$repo_root/apps/dashboard/public/certifyd-icon.png" "$assets_stage/certifyd-core.png"
elif [[ -f "$repo_root/apps/dashboard/public/favicon.ico" ]]; then
  cp "$repo_root/apps/dashboard/public/favicon.ico" "$assets_stage/certifyd-core.ico"
fi

echo "[linux-package] Installing API dependencies into staging..."
"$npm_bin" --prefix "$api_target" ci

echo "[linux-package] Generating Linux Prisma client..."
api_schema="$api_target/prisma/schema.prisma"
package_db="$api_target/contentbox-package-build.db"
export DATABASE_URL="file:$package_db"
"$npm_bin" --prefix "$api_target" exec -- prisma validate --schema "$api_schema"
"$npm_bin" --prefix "$api_target" exec -- prisma generate --schema "$api_schema"
rm -f "$package_db"

echo "[linux-package] Installing dashboard dependencies into staging..."
"$npm_bin" --prefix "$dashboard_target" ci
echo "[linux-package] Building dashboard..."
"$npm_bin" --prefix "$dashboard_target" run build
rm -rf "$dashboard_target/node_modules"

checks=(
  "$node_bin"
  "$api_target/node_modules/tsx"
  "$api_target/node_modules/prisma/build/index.js"
  "$api_target/node_modules/.prisma/client"
  "$api_target/prisma/schema.prisma"
  "$dashboard_target/dist/index.html"
  "$app_stage/start.sh"
)
for check in "${checks[@]}"; do
  if [[ ! -e "$check" ]]; then
    echo "[linux-package] Missing expected packaged artifact: $check" >&2
    exit 1
  fi
done

if ! find "$api_target/node_modules/@prisma/engines" -type f \( -name '*linux*' -o -name 'schema-engine*' \) | grep -q .; then
  echo "[linux-package] Missing expected Linux Prisma engine artifacts." >&2
  exit 1
fi

archive="Certifyd-Core-$version-linux-$target_arch.tar.gz"
archive_path="$package_dir/$archive"
rm -f "$archive_path" "$archive_path.sha256"
tar -C "$stage_root" -czf "$archive_path" "Certifyd-Core-$version-linux-$target_arch"
sha256sum "$archive_path" | tee "$archive_path.sha256"

echo "[linux-package] Done."
echo "[linux-package] Package: $archive_path"
