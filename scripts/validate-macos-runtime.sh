#!/usr/bin/env bash
# Shared functional smoke: routine unsigned CI and final notarized DMGs.
set -euo pipefail
DMG_PATH="${1:?DMG required}"
target_arch="${2:?architecture required}"
runtime_port="${3:?port required}"
RELEASE_VERSION="${4:?version required}"
trust_mode="${5:-unsigned}"
[[ "$trust_mode" == signed || "$trust_mode" == unsigned ]] || exit 1
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="$(command -v python3)"
mount_dir="$(mktemp -d)"
app_install_dir="$(mktemp -d)"
data_root="$(mktemp -d)"
move_root="$(mktemp -d)"
attach_output="$(hdiutil attach "$DMG_PATH" -mountpoint "$mount_dir" -nobrowse -readonly)"
echo "$attach_output"
chrome_pid=""
chrome_profile=""
cleanup() {
  if [[ -n "$chrome_pid" ]]; then
    kill "$chrome_pid" >/dev/null 2>&1 || true
    wait "$chrome_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$chrome_profile" ]]; then
    rm -rf "$chrome_profile"
  fi
  if [[ -f "$data_root/state/certifyd-core.pid" ]]; then
    CONTENTBOX_ROOT="$data_root" /bin/bash "$repo_root/packaging/macos/stop.sh" || true
  fi
  hdiutil detach "$mount_dir" -quiet || true
}
trap cleanup EXIT

# Keep forensic output outside the sealed app. A launcher verification error can
# identify a changed bundle resource, not necessarily changed executable bytes.
signed_integrity_checkpoint() {
  local stage="$1"
  local checked_app="$2"
  [[ "$trust_mode" == signed ]] || return 0
  local diagnostics="$repo_root/.dist/macos-$target_arch/signing-logs"
  local report="$diagnostics/integrity-$stage.txt"
  local launcher="$checked_app/Contents/MacOS/CertifydCoreLauncher"
  mkdir -p "$diagnostics"
  {
    echo "Stage=$stage"
    shasum -a 256 "$launcher" "$checked_app/Contents/_CodeSignature/CodeResources"
    /usr/bin/stat -f 'mode=%Sp size=%z mtime=%m ctime=%c inode=%i' "$launcher"
    /usr/bin/xattr -lx "$launcher"
    /usr/bin/codesign -d --verbose=4 "$launcher"
    find "$checked_app/Contents/Resources/app/apps/api/node_modules/@prisma/engines" \
      -maxdepth 1 -type f -name '*darwin*' -exec shasum -a 256 {} \;
  } > "$report" 2>&1
  local result=0
  /usr/bin/codesign --verify --deep --strict --all-architectures --verbose=4 \
    "$checked_app" >> "$report" 2>&1 || result=$?
  cat "$report"
  return "$result"
}

signed_integrity_checkpoint mounted "$mount_dir/Certifyd Core.app"
if [[ "$trust_mode" == signed ]]; then
  "$python_bin" "$repo_root/scripts/macos-release.py" verify-app "$mount_dir/Certifyd Core.app" --arch "$target_arch" --version "$RELEASE_VERSION"
  spctl --assess --type execute --verbose=4 "$mount_dir/Certifyd Core.app" 2>&1 | tee "$repo_root/.dist/macos-$target_arch/signing-logs/gatekeeper-mounted-app.txt"
fi
cp -R "$mount_dir/Certifyd Core.app" "$app_install_dir/Certifyd Core.app"
app="$app_install_dir/Certifyd Core.app"
test -d "$app/Contents"
if find "$app" -name '.env' -o -name '.env.*' | grep -q .; then
  echo "Packaged .env file found" >&2
  exit 1
fi
test -x "$app/Contents/MacOS/CertifydCoreLauncher"
test -f "$app/Contents/Resources/CertifydCore.icns"
test -f "$app/Contents/Resources/app/apps/dashboard/dist/index.html"

node_bin="$app/Contents/Resources/runtime/node/bin/node"
blocked_bin="$(mktemp -d)"
for blocked in git node npm; do
  printf '#!/usr/bin/env bash\n' >"$blocked_bin/$blocked"
  # shellcheck disable=SC2016 # Expand in the generated shim, not in this script.
  printf 'echo "blocked system command was invoked: $(basename "$0")" >&2\n' >>"$blocked_bin/$blocked"
  printf 'exit 127\n' >>"$blocked_bin/$blocked"
  chmod +x "$blocked_bin/$blocked"
done
export PATH="$blocked_bin:/usr/bin:/bin:/usr/sbin:/sbin"

dump_runtime_diagnostics() {
  echo "Runtime diagnostics for macOS $target_arch"
  pgrep -fl 'Certifyd|tsx|src/server|node' || true
  if [[ -f "$data_root/logs/certifyd-core.out.log" ]]; then
    echo "--- certifyd-core.out.log ---"
    tail -n 120 "$data_root/logs/certifyd-core.out.log" || true
  fi
  if [[ -f "$data_root/logs/certifyd-core.err.log" ]]; then
    echo "--- certifyd-core.err.log ---"
    tail -n 120 "$data_root/logs/certifyd-core.err.log" || true
  fi
  if [[ -f "$data_root/logs/chrome-pwa.log" ]]; then
    echo "--- chrome-pwa.log ---"
    tail -n 120 "$data_root/logs/chrome-pwa.log" || true
  fi
}

run_with_timeout() {
  local label="$1"
  local seconds="$2"
  shift 2
  echo "BEGIN: $label"
  "$@" &
  local command_pid="$!"
  local deadline=$((SECONDS + seconds))
  while kill -0 "$command_pid" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "TIMEOUT after ${seconds}s: $label" >&2
      dump_runtime_diagnostics
      kill "$command_pid" >/dev/null 2>&1 || true
      sleep 2
      kill -9 "$command_pid" >/dev/null 2>&1 || true
      wait "$command_pid" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 1
  done
  set +e
  wait "$command_pid"
  local status="$?"
  set -e
  echo "END: $label status=$status"
  return "$status"
}

"$node_bin" --version | tee -a "macos-$target_arch-validation-summary.md"
file "$node_bin" | tee -a "macos-$target_arch-validation-summary.md"
find "$app/Contents/Resources/app/apps/api/node_modules/@prisma/engines" -maxdepth 1 -type f -name '*darwin*' -print | sort | tee -a "macos-$target_arch-validation-summary.md"
file "$app/Contents/Resources/app/apps/api/node_modules/bcrypt/prebuilds/darwin-$target_arch/bcrypt.node" | tee -a "macos-$target_arch-validation-summary.md"
plutil -lint "$app/Contents/Info.plist"
{
  file "$app/Contents/MacOS/CertifydCoreLauncher"
  printf 'CFBundleShortVersionString='
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"
  printf 'CFBundleVersion='
  /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist"
} | tee -a "macos-$target_arch-validation-summary.md"
if [[ "$trust_mode" == signed ]]; then
  "$python_bin" "$repo_root/scripts/macos-release.py" verify-app "$app" --arch "$target_arch" --version "$RELEASE_VERSION"
  spctl --assess --type execute --verbose=4 "$app" 2>&1 | tee "$repo_root/.dist/macos-$target_arch/signing-logs/gatekeeper-app.txt"
fi

signed_integrity_checkpoint before-first-launch "$app"
run_with_timeout "first launch" 180 env CERTIFYD_NO_BROWSER=1 CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/MacOS/CertifydCoreLauncher"
signed_integrity_checkpoint after-first-launch "$app"
run_with_timeout "status after first launch" 30 env CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/Resources/status.sh" | tee -a "macos-$target_arch-validation-summary.md"
"$node_bin" -e 'const http=require("http"); http.get(process.argv[1], res => { console.log("health", res.statusCode); res.resume(); res.on("end",()=>process.exit(res.statusCode===200?0:1)); }).on("error", err => { console.error(err.message); process.exit(1); });' "http://127.0.0.1:$runtime_port/health"
"$node_bin" -e 'const http=require("http"); http.get(process.argv[1], res => { console.log("dashboard", res.statusCode); res.resume(); res.on("end",()=>process.exit(res.statusCode===200?0:1)); }).on("error", err => { console.error(err.message); process.exit(1); });' "http://127.0.0.1:$runtime_port/"

first_pid="$(tr -dc '0-9' <"$data_root/state/certifyd-core.pid")"
test -n "$first_pid"
kill -0 "$first_pid"
run_with_timeout "second launch" 60 env CERTIFYD_NO_BROWSER=1 CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/MacOS/CertifydCoreLauncher"
second_pid="$(tr -dc '0-9' <"$data_root/state/certifyd-core.pid")"
test "$second_pid" = "$first_pid"
core_process_count="$(ps -ax -o pid=,command= | "$python_bin" -c '
import os, sys
node = sys.argv[1]
rows = []
for line in sys.stdin:
    fields = line.strip().split(None, 1)
    if len(fields) == 2 and int(fields[0]) != os.getpid() and node in fields[1] and "src/server.ts" in fields[1]:
        rows.append(line)
print(len(rows))
' "$node_bin")"
test "$core_process_count" = "1"
"$node_bin" -e 'const http=require("http"); http.get(process.argv[1], res => { console.log("health-after-second-launch", res.statusCode); res.resume(); res.on("end",()=>process.exit(res.statusCode===200?0:1)); }).on("error", err => { console.error(err.message); process.exit(1); });' "http://127.0.0.1:$runtime_port/health"

chrome_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
test -x "$chrome_bin"
chrome_profile="$(mktemp -d)"
chrome_debug_port=$((runtime_port + 5000))
"$chrome_bin" \
  --headless=new \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --remote-debugging-port="$chrome_debug_port" \
  --remote-allow-origins="http://127.0.0.1:$chrome_debug_port" \
  --user-data-dir="$chrome_profile" \
  --app="http://127.0.0.1:$runtime_port/" \
  >"$data_root/logs/chrome-pwa.log" 2>&1 &
chrome_pid="$!"
"$python_bin" "$repo_root/scripts/validate-pwa-chrome.py" \
  --origin "http://127.0.0.1:$runtime_port" \
  --debug-port "$chrome_debug_port" | tee -a "macos-$target_arch-validation-summary.md"
kill "$chrome_pid" >/dev/null 2>&1 || true
wait "$chrome_pid" >/dev/null 2>&1 || true
chrome_pid=""
rm -rf "$chrome_profile"
chrome_profile=""

test -f "$data_root/contentbox.db"
db_hash_before="$(shasum -a 256 "$data_root/contentbox.db" | awk '{print $1}')"
db_size_before="$(stat -f '%z' "$data_root/contentbox.db")"

run_with_timeout "stop after first launch" 45 env CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/Resources/stop.sh"
signed_integrity_checkpoint after-first-stop "$app"
run_with_timeout "restart" 180 env CERTIFYD_NO_BROWSER=1 CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/MacOS/CertifydCoreLauncher"
signed_integrity_checkpoint after-restart "$app"
db_hash_restart="$(shasum -a 256 "$data_root/contentbox.db" | awk '{print $1}')"
run_with_timeout "stop after restart" 45 env CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$app/Contents/Resources/stop.sh"
signed_integrity_checkpoint after-restart-stop "$app"

mv "$app" "$move_root/Certifyd Core.app"
moved_app="$move_root/Certifyd Core.app"
moved_node_bin="$moved_app/Contents/Resources/runtime/node/bin/node"
signed_integrity_checkpoint after-move "$moved_app"
run_with_timeout "launch after move" 180 env CERTIFYD_NO_BROWSER=1 CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$moved_app/Contents/MacOS/CertifydCoreLauncher"
signed_integrity_checkpoint after-moved-launch "$moved_app"
"$moved_node_bin" -e 'const http=require("http"); http.get(process.argv[1], res => { console.log("health-after-move", res.statusCode); res.resume(); res.on("end",()=>process.exit(res.statusCode===200?0:1)); }).on("error", err => { console.error(err.message); process.exit(1); });' "http://127.0.0.1:$runtime_port/health"
run_with_timeout "stop after move" 45 env CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$moved_app/Contents/Resources/stop.sh"
signed_integrity_checkpoint after-moved-stop "$moved_app"
db_hash_after="$(shasum -a 256 "$data_root/contentbox.db" | awk '{print $1}')"
db_size_after="$(stat -f '%z' "$data_root/contentbox.db")"

test "$db_hash_before" = "$db_hash_restart"
test "$db_hash_before" = "$db_hash_after"
test "$db_size_before" = "$db_size_after"
test -f "$data_root/config/api.env"
{
  echo "Runtime start=PASS"
  echo "Health=PASS"
  echo "Dashboard=PASS"
  echo "Second launch single-process behavior=PASS"
  echo "Chrome PWA standalone/live runtime=PASS"
  echo "Stop/status=PASS"
  echo "Restart/persistence=PASS"
  echo "Moved app=PASS"
  echo "Existing data preserved=PASS"
  echo "System git/node/npm shims not invoked=PASS"
  echo "DB size before=$db_size_before"
  echo "DB size after=$db_size_after"
} | tee -a "macos-$target_arch-validation-summary.md"

# Exercise the Node JIT and a real native addon under the installed signature.
"$moved_node_bin" -e 'const bcrypt=require(process.argv[1]); const h=bcrypt.hashSync("smoke",4); if(!bcrypt.compareSync("smoke",h)) process.exit(1); let n=0; const f=new Function("x","return x+1"); for(let i=0;i<1000000;i++) n=f(n); if(n!==1000000) process.exit(1);' "$moved_app/Contents/Resources/app/apps/api/node_modules/bcrypt"
signed_integrity_checkpoint after-jit "$moved_app"
run_with_timeout "LAN launch" 180 env CERTIFYD_NO_BROWSER=1 CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$moved_app/Contents/MacOS/CertifydCoreLauncher" --lan
signed_integrity_checkpoint after-lan-launch "$moved_app"
grep -q '^CONTENTBOX_PRIVATE_BIND="public"$' "$data_root/config/api.env"
grep -q '^CONTENTBOX_BIND="local"$' "$data_root/config/api.env"
run_with_timeout "stop after LAN launch" 45 env CONTENTBOX_ROOT="$data_root" PORT="$runtime_port" "$moved_app/Contents/Resources/stop.sh"
signed_integrity_checkpoint after-lan-stop "$moved_app"
if [[ "$trust_mode" == signed ]]; then
  "$python_bin" "$repo_root/scripts/macos-release.py" verify-app "$moved_app" --arch "$target_arch" --version "$RELEASE_VERSION"
  spctl --assess --type execute --verbose=4 "$moved_app" 2>&1 | tee "$repo_root/.dist/macos-$target_arch/signing-logs/gatekeeper-moved-app.txt"
fi
printf '%s\n' 'Native addon/JIT=PASS' 'LAN private bind=PASS' 'Public listener unchanged=PASS' >> "macos-$target_arch-validation-summary.md"
