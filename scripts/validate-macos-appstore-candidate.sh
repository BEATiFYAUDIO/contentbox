#!/usr/bin/env bash
set -euo pipefail

arch="${1:?x64 or arm64 required}"
port="${2:?port required}"
app=".dist/macos-$arch/stage/Certifyd Core.app"
resources="$app/Contents/Resources"
launcher="$app/Contents/MacOS/CertifydCoreLauncher"
container_home="$HOME/Library/Containers/me.certifyd.core/Data"
data_root="$container_home/Library/Application Support/ContentBox"
legacy_root="$HOME/Library/Application Support/ContentBox"
test -x "$launcher"

# Preserve a stand-in for an existing non-sandboxed installation.
mkdir -p "$legacy_root" "$container_home"
printf 'keep-existing-data\n' >"$legacy_root/appstore-validation-sentinel"
legacy_hash="$(shasum -a 256 "$legacy_root/appstore-validation-sentinel" | cut -d' ' -f1)"

export PORT="$port" CERTIFYD_NO_BROWSER=1 CERTIFYD_LAUNCHER_NO_UI=1
export PUBLIC_MODE=off CONTENTBOX_BIND=local CONTENTBOX_PRIVATE_BIND=local
export APP_BASE_URL="http://127.0.0.1:$port"

cleanup() {
  CONTENTBOX_ROOT="$data_root" bash "$resources/stop.sh" >/dev/null 2>&1 || true
  rm -f "$legacy_root/appstore-validation-sentinel"
}
trap cleanup EXIT

if ! "$launcher"; then
  echo "Candidate startup failed; process and logs follow:" >&2
  ps -ax -o pid=,command= | grep -F 'src/server.ts' || true
  tail -n 80 "$data_root/logs/certifyd-core.err.log" >&2 || true
  tail -n 80 "$data_root/logs/certifyd-core.out.log" >&2 || true
  exit 1
fi
test -s "$data_root/config/api.env"
test -s "$data_root/contentbox.db"
test -s "$data_root/.node/node_private.pem"
test -s "$data_root/.node/node_public.pem"
curl -fsS "http://127.0.0.1:$port/health" >/dev/null
private_hash="$(shasum -a 256 "$data_root/.node/node_private.pem" | cut -d' ' -f1)"
config_hash="$(shasum -a 256 "$data_root/config/api.env" | cut -d' ' -f1)"
CONTENTBOX_ROOT="$data_root" bash "$resources/stop.sh"

"$launcher"
curl -fsS "http://127.0.0.1:$port/health" >/dev/null
test "$private_hash" = "$(shasum -a 256 "$data_root/.node/node_private.pem" | cut -d' ' -f1)"
test "$config_hash" = "$(shasum -a 256 "$data_root/config/api.env" | cut -d' ' -f1)"
test "$legacy_hash" = "$(shasum -a 256 "$legacy_root/appstore-validation-sentinel" | cut -d' ' -f1)"

echo "Candidate startup/restart: PASS"
echo "Sandbox-container data/key persistence: PASS"
echo "Legacy data path unchanged: PASS"
echo "LAN-device reachability: UNTESTED (CI has no phone on runner LAN)"
