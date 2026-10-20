#!/usr/bin/env bash
set -euo pipefail
platform="${1:?linux or macos}"
arch="${2:?x64 or arm64}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_root="$(mktemp -d)"
data_root="$test_root/data"
mkdir -p "$data_root"
export CONTENTBOX_ROOT="$data_root" PORT=4614 CONTENTBOX_PUBLIC_PORT=4615 CERTIFYD_NO_BROWSER=1
export DATABASE_URL="file:$data_root/contentbox.db"
export TEST_USER_ID_FILE="$test_root/user-id"
old_mount='' new_mount='' app='' stop_script=''
cleanup() {
  if [[ -n "$stop_script" && -x "$stop_script" ]]; then "$stop_script" >/dev/null 2>&1 || true; fi
  [[ -z "$old_mount" ]] || hdiutil detach "$old_mount" -quiet >/dev/null 2>&1 || true
  [[ -z "$new_mount" ]] || hdiutil detach "$new_mount" -quiet >/dev/null 2>&1 || true
  if [[ "$platform" == linux ]]; then sudo dpkg -r certifyd-core >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [[ "$platform" == linux ]]; then
  old="Certifyd-Core-0.1.0-beta.23-linux-arm64.deb"
  new="Certifyd-Core-0.1.0-beta.24-linux-arm64.deb"
  expected_new=cbc06f6f9410927c02a7134203bad11432036025763dbc770671fc746d4599dc
  gh release download v0.1.0-beta.23 -R BEATiFYAUDIO/contentbox --pattern "$old" --pattern SHA256SUMS.txt --dir "$test_root"
  gh run download 39461985152 -R BEATiFYAUDIO/contentbox -n certifyd-core-linux-arm64-0.1.0-beta.24 -D "$test_root"
  candidate_path="$(find "$test_root" -type f -name "$new" -print -quit)"
  test -n "$candidate_path"
  (cd "$test_root" && grep "  $old$" SHA256SUMS.txt | shasum -a 256 -c -)
  printf '%s  %s\n' "$expected_new" "$candidate_path" | shasum -a 256 -c -
  sudo dpkg -i "$test_root/$old"
  app=/opt/certifyd-core
  start() { "$app/start.sh"; }
  stop_script="$app/stop.sh"
  node="$app/runtime/node/bin/node"
  api="$app/apps/api"
else
  old="Certifyd-Core-0.1.0-beta.23-macos-${arch}.dmg"
  new="Certifyd-Core-0.1.0-beta.24-macos-${arch}.dmg"
  if [[ "$arch" == x64 ]]; then expected_new=a22d3c06dfe15a79173f2d196b520cf5029d6252eb0330c778d6fc4a5782a58b; else expected_new=ba8805be78ea8676ec9f2708ae9c6ffac0b82c17de9bcf9fefd5e7bf81eb0a8f; fi
  gh release download v0.1.0-beta.23 -R BEATiFYAUDIO/contentbox --pattern "$old" --pattern SHA256SUMS.txt --dir "$test_root"
  gh run download 39462464618 -R BEATiFYAUDIO/contentbox -n "certifyd-core-signed-macos-${arch}-0.1.0-beta.24" -D "$test_root"
  (cd "$test_root" && grep "  $old$" SHA256SUMS.txt | shasum -a 256 -c -)
  printf '%s  %s\n' "$expected_new" "$test_root/$new" | shasum -a 256 -c -
  old_mount="$test_root/old-mount"; new_mount="$test_root/new-mount"
  mkdir -p "$old_mount" "$new_mount" "$test_root/Applications"
  hdiutil attach "$test_root/$old" -mountpoint "$old_mount" -nobrowse -readonly -quiet
  ditto "$old_mount/Certifyd Core.app" "$test_root/Applications/Certifyd Core.app"
  app="$test_root/Applications/Certifyd Core.app"
  start() { "$app/Contents/MacOS/CertifydCoreLauncher"; }
  stop_script="$app/Contents/Resources/stop.sh"
  node="$app/Contents/Resources/runtime/node/bin/node"
  api="$app/Contents/Resources/app/apps/api"
fi

health() { curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; curl -fsS "http://127.0.0.1:$PORT/" >/dev/null; }
start
health
signup="$(curl -fsS -H 'content-type: application/json' -d '{"email":"beta24-native-upgrade@example.test","password":"SyntheticOnly1234!","displayName":"Test Creator"}' "http://127.0.0.1:$PORT/auth/signup")"
printf '%s' "$signup" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["user"]["id"])' > "$TEST_USER_ID_FILE"
login() {
  curl -fsS -H 'content-type: application/json' -d '{"email":"beta24-native-upgrade@example.test","password":"SyntheticOnly1234!"}' "http://127.0.0.1:$PORT/auth/login" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["user"]["email"]=="beta24-native-upgrade@example.test"; print("normal login=PASS")'
}
login
export CORE_API_DIR="$api"
"$node" "$repo_root/scripts/tests/beta24-native-upgrade-commerce.cjs" seed
"$stop_script"
test ! -f "$data_root/state/certifyd-core.pid"

if [[ "$platform" == linux ]]; then
  sudo dpkg -i "$candidate_path"
  app=/opt/certifyd-core
  stop_script="$app/stop.sh"
  node="$app/runtime/node/bin/node"
  api="$app/apps/api"
else
  hdiutil attach "$test_root/$new" -mountpoint "$new_mount" -nobrowse -readonly -quiet
  codesign --verify --deep --strict --all-architectures "$new_mount/Certifyd Core.app"
  spctl --assess --type execute "$new_mount/Certifyd Core.app"
  rm -rf "$app"
  ditto "$new_mount/Certifyd Core.app" "$app"
  node="$app/Contents/Resources/runtime/node/bin/node"
  api="$app/Contents/Resources/app/apps/api"
fi
export CORE_API_DIR="$api"
start
health
login
"$node" "$repo_root/scripts/tests/beta24-native-upgrade-commerce.cjs" verify
first_pid="$(tr -dc '0-9' < "$data_root/state/certifyd-core.pid")"
start
test "$(tr -dc '0-9' < "$data_root/state/certifyd-core.pid")" = "$first_pid"
"$stop_script"
start
health
login
"$node" "$repo_root/scripts/tests/beta24-native-upgrade-commerce.cjs" verify
python3 - "$data_root/contentbox.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1]); assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'; print('SQLite integrity=PASS')
PY
echo "${platform}/${arch} Beta23 to Beta24 native upgrade, restart, creator and commerce preservation=PASS"
