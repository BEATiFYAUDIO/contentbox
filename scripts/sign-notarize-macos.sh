#!/usr/bin/env bash
# Called only by the protected manual workflow, after dependency installation/build.
# Never run with tracing, and never print/import private material into the repo.
set +x
set -euo pipefail
umask 077
target_arch="${1:?architecture required}"
version="${2:?version required}"
[[ "$(uname -s)" == Darwin ]] || exit 1
[[ "$target_arch" == x64 || "$target_arch" == arm64 ]] || exit 1
for name in APPLE_CERTIFICATE_P12 APPLE_CERTIFICATE_PASSWORD APPLE_API_KEY_P8 APPLE_API_KEY_ID APPLE_API_ISSUER_ID APPLE_TEAM_ID RUNNER_TEMP; do
  if [[ -z "${!name:-}" ]]; then
    echo "Required signing input missing: $name" >&2
    exit 1
  fi
done
[[ "$APPLE_TEAM_ID" == KYAPD65KRD ]] || { echo "Unexpected Apple team" >&2; exit 1; }
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$repo_root/scripts/macos-release.py" versions --version "$version" >/dev/null
private_dir="$(mktemp -d "$RUNNER_TEMP/certifyd-signing.XXXXXX")"
keychain="$private_dir/signing.keychain-db"
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$private_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Fallback cleanup in an always() workflow step if this step is interrupted.
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'CERTIFYD_SIGNING_TEMP=%s\n' "$private_dir" >> "$GITHUB_ENV"
fi
export CERTIFYD_SIGNING_TEMP="$private_dir"
python3 - <<'PY'
import base64, os
from pathlib import Path
root = Path(os.environ['CERTIFYD_SIGNING_TEMP'])
try:
    for variable, filename in [('APPLE_CERTIFICATE_P12', 'certificate.p12'), ('APPLE_API_KEY_P8', 'notary.p8')]:
        data = base64.b64decode(''.join(os.environ[variable].split()), validate=True)
        if not data:
            raise ValueError()
        (root / filename).write_bytes(data)
except Exception:
    raise SystemExit('Signing secret must contain nonempty base64-encoded file contents')
PY
unset APPLE_CERTIFICATE_P12 APPLE_API_KEY_P8
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain" >/dev/null 2>&1
security set-keychain-settings -lut 21600 "$keychain" >/dev/null 2>&1
security unlock-keychain -p "$keychain_password" "$keychain" >/dev/null 2>&1
if ! security import "$private_dir/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null 2>&1; then
  echo "Developer ID certificate import failed" >&2
  exit 1
fi
unset APPLE_CERTIFICATE_PASSWORD
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null 2>&1
unset keychain_password
identity='Developer ID Application: Hwy 11 Entertainment Inc (KYAPD65KRD)'
security find-identity -v -p codesigning "$keychain" | grep -Fq "$identity" || { echo "Expected Developer ID identity unavailable" >&2; exit 1; }

dist_root="$repo_root/.dist/macos-$target_arch"
app="$dist_root/stage/Certifyd Core.app"
logs="$dist_root/signing-logs"
mkdir -p "$logs"
python3 "$repo_root/scripts/macos-release.py" sign-app "$app" --arch "$target_arch" --version "$version" --keychain "$keychain" > "$logs/macho-signatures.json"
bash "$repo_root/scripts/create-macos-dmg.sh" "$target_arch" "$version"
dmg="$dist_root/package/Certifyd-Core-$version-macos-$target_arch.dmg"
python3 "$repo_root/scripts/macos-release.py" sign-dmg "$dmg" --keychain "$keychain"

notary_args=(--key "$private_dir/notary.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID")
submit_status=0
xcrun notarytool submit "$dmg" "${notary_args[@]}" --wait --timeout 45m --output-format json > "$logs/notary-submit.json" || submit_status=$?
submission_id="$(python3 - "$logs/notary-submit.json" <<'PY'
import json, sys, uuid
try:
    print(uuid.UUID(json.load(open(sys.argv[1]))['id']))
except Exception:
    raise SystemExit('Notary submission did not return a valid ID; inspect notary-submit.json')
PY
)"
echo "Notarization submission: $submission_id"
# Always retrieve Apple's log, including accepted submissions with warnings.
xcrun notarytool log "$submission_id" "${notary_args[@]}" "$logs/notary-log.json"
python3 "$repo_root/scripts/macos-release.py" notary-result "$logs/notary-submit.json" --log "$logs/notary-log.json" --submit-status "$submit_status"
xcrun stapler staple "$dmg" > "$logs/staple.txt" 2>&1
xcrun stapler validate "$dmg" >> "$logs/staple.txt" 2>&1
python3 "$repo_root/scripts/macos-release.py" verify-dmg "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg" > "$logs/gatekeeper-dmg.txt" 2>&1
# Stapling changes the DMG. Only this final digest is suitable for distribution.
shasum -a 256 "$dmg" | tee "$dmg.sha256"
printf '%s\n' "Source commit=$(git -C "$repo_root" rev-parse HEAD)" "Version=$version" "Architecture=$target_arch" "Identity=$identity" "Notarization=Accepted" "Staple=PASS" > "$logs/provenance.txt"
