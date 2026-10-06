# macOS Developer ID validation

Status: implemented for review; **not yet validated on macOS or with Apple**.
Nothing here changes the public beta.11 binaries. Do not advertise signed releases
until both native jobs and a clean-Mac installation test have passed.

## Build and trust flow

- Ordinary `.github/workflows/macos-package-validation.yml`: no environment or Apple
  secrets; builds/validates unsigned engineering DMGs. Empty `source_ref` uses the
  workflow commit. Explicit refs must be full SHAs containing the current scripts.
- Manual `.github/workflows/macos-release-signing.yml`: only `main` and the dedicated
  `feat/macos-developer-id-notarization` review branch, protected by `macos-release`.
  No arbitrary source input: checkout must equal the dispatched workflow SHA.
- Preserve native runners: `macos-14-large` for x64, `macos-14-xlarge` for arm64.
  Each independently builds, signs, notarizes, staples and validates its DMG. Runner
  availability/access and Xcode tools must be confirmed by actual CI runs.
- Build dependencies/dashboard and generate Prisma **before** importing credentials.
  The completed app's `file`/`lipo` inventory includes every discovered Mach-O,
  including bundled Node, Prisma, native addons, and transitive executables.
- Sign deepest code first, then nested bundles, then the outer app. No signing
  operation uses `--deep`; deep verification is an additional final gate.
- Create the existing hdiutil DMG from that signed app, sign the DMG, submit it with
  `notarytool`, require `Accepted`, retrieve Apple's log, staple and validate the
  ticket. Never upload a pre-staple digest as the final digest.
- Verify DMG integrity/signature/Gatekeeper, mount that final image and validate its
  app, including the same runtime smoke used by unsigned CI. Recheck the moved app's
  signature after launch to catch writes into sealed resources.
- The workflow uploads only the successful final DMG/hash and allowlisted diagnostics
  as Actions artifacts. It does not tag, create releases, or deploy downloads.

## Launcher and bundle metadata

`Contents/MacOS/CertifydCoreLauncher` is a tiny native C executable. It locates
itself with `_NSGetExecutablePath`, resolves the adjacent Resources script, and
executes `/bin/bash` with the original arguments, including `--lan`. No new runtime
or framework is installed. Shell startup injection through `BASH_ENV`/`ENV` is
disabled. Existing API, data-directory, browser-opening and LAN behavior stays in
`Contents/Resources/CertifydCoreLauncher.sh`.

The bundled status helper resolves Node relative to its Resources directory.
Data remains outside the app in `~/Library/Application Support/ContentBox`.

`scripts/macos-release.py versions --version 0.1.0-beta.12` outputs:

```text
0.1.0 2.0.12
```

For public `M.m.p-beta.N`, short version is `M.m.p`; build version is
`(M*100+m+1).p.N`. Unnumbered `-beta` maps to iteration 0; stable releases map to
99. Bounds are M<=98, m/p<=99 and numbered beta 1..98, so components fit Apple's
numeric limits and successive betas, stable, patches, minors and majors increase.
Unsupported inputs fail instead of silently truncating/colliding. Artifact names
retain the exact public version. No release version is selected by this runbook.

Why not build `12` alone? It orders this beta series, but resets if the next patch
or minor starts at beta.1. Encoding the release series keeps the build value
monotonic across those transitions without a separate global build counter:
`0.1.0-beta.12` → `2.0.12`, `0.1.0` → `2.0.99`,
`0.1.1-beta.1` → `2.1.1`, `0.2.0-beta.1` → `3.0.1`.
The first component's +1 keeps it positive even for a 0.0 release series.

## Entitlements and native code

Only bundled Node receives `com.apple.security.cs.allow-jit=true`. V8 allocates
JIT pages using `MAP_JIT`; see [Apple's entitlement documentation](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.cs.allow-jit)
and the [bundled Node 20.19 V8 source](https://github.com/nodejs/node/blob/v20.19.0/deps/v8/src/base/platform/platform-posix.cc).
The runtime smoke exercises JavaScript JIT, bcrypt and Prisma on each native target.

Node's upstream signing plist contains broader privileges. We do **not** copy it.
No `disable-library-validation`, `allow-unsigned-executable-memory`,
`disable-executable-page-protection`, `allow-dyld-environment-variables`, or
`get-task-allow` is granted. All bundled native modules are re-signed with the same
Developer ID team so library validation remains enabled. Launcher and other native
code have no entitlements. Secure timestamps and Developer ID/team checks are hard
gates; Hardened Runtime is required on executables. Unexpected entitlements fail.

Minimum entitlement sufficiency is not proven until both credentialed runtime jobs
pass. If either fails, preserve diagnostics and investigate the precise native
operation before considering any exception. Do not add broad exceptions to make CI green.

## Environment protection and credentials (manual prerequisite)

Before uploading secrets, configure GitHub **Settings → Environments → macos-release**:

1. Required trusted reviewers; disallow self-approval/admin bypass where supported.
2. Selected deployment **branches**, exactly `main` and, during reviewed testing,
   `feat/macos-developer-id-notarization`. No wildcard, arbitrary temporary branch,
   PR ref, or tag. Remove the testing branch allowance when testing is finished.
3. Review/protect write access to those branches and the workflow/scripts.

GitHub's environment protection rules enforce approval and branch restrictions
before the credentialed job starts. There is no runtime environment-policy API
query or elevated token permission dependency. The manual dispatch input
`environment_protection_confirmed` defaults to false and must be explicitly
acknowledged; it is not an automated proof that rules exist. An administrator must
configure and review those rules before any Apple secrets are uploaded.
Environment branch restrictions are essential: a workflow YAML condition alone
cannot stop a different workflow on an untrusted branch requesting the same
secrets. Do not store these credentials as repository/organization-wide secrets.
Do not grant this environment to ordinary CI.

The audit found the environment empty and unprotected; no settings were changed.

Required environment **secrets**:

- `APPLE_CERTIFICATE_P12`: base64 of the password-protected Developer ID `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: that file's password.
- `APPLE_API_KEY_P8`: base64 of the App Store Connect Team API `.p8` file.

Required environment **variables** (public identifiers, not private keys):

- `APPLE_API_KEY_ID`: `5Z6XU86VNB`
- `APPLE_API_ISSUER_ID`: `1fdc0a43-9fd0-4103-a149-2de5e076ac8e`
- `APPLE_TEAM_ID`: `KYAPD65KRD`

Upload from your trusted local terminal with tracing off. Replace only the local
file paths; don't paste private material into chat, source, or command arguments.
The pipes below pass encoded contents directly to GitHub without displaying them.
Use a current GitHub CLI for `gh variable set` (older installations lack it).

```bash
set +x
base64 < /secure/path/developer-id.p12 | gh secret set APPLE_CERTIFICATE_P12 --repo BEATiFYAUDIO/contentbox --env macos-release
gh secret set APPLE_CERTIFICATE_PASSWORD --repo BEATiFYAUDIO/contentbox --env macos-release
base64 < /secure/path/AuthKey_5Z6XU86VNB.p8 | gh secret set APPLE_API_KEY_P8 --repo BEATiFYAUDIO/contentbox --env macos-release
gh variable set APPLE_API_KEY_ID --body '5Z6XU86VNB' --repo BEATiFYAUDIO/contentbox --env macos-release
gh variable set APPLE_API_ISSUER_ID --body '1fdc0a43-9fd0-4103-a149-2de5e076ac8e' --repo BEATiFYAUDIO/contentbox --env macos-release
gh variable set APPLE_TEAM_ID --body 'KYAPD65KRD' --repo BEATiFYAUDIO/contentbox --env macos-release
```

The password command prompts securely. Base64 is encoding, not encryption; keep
the originals protected outside the repository. Patterns for `.p12`, `.p8`, `.pfx`,
`.key`, `.pem` and keychain files are ignored. Public certificate material, if ever
needed, should use an explicitly reviewed `.cer`/`.crt` path, never a private key.

CI decodes into a mode-0700 job temporary directory (umask 077), imports only into
a temporary keychain with a random password, and gives codesign access to that key.
No permanent/default keychain is changed. Shell tracing/import output is suppressed.
EXIT/signal traps plus an `always()` cleanup step remove the keychain and decoded
files. Credentials are step-scoped and are not uploaded. macOS `security` requires
password arguments for these operations; use only isolated GitHub-hosted runners,
not a shared machine where other users could observe process arguments.

## Validation and diagnosis

Portable checks (no Apple credentials, builds or databases):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_macos_release.py'
bash -n scripts/build-macos-package.sh scripts/create-macos-dmg.sh scripts/sign-notarize-macos.sh scripts/validate-macos-runtime.sh
git diff --check
```

After explicit approval, push only the reviewed release-engineering branch and
enable/dispatch the manual workflow with an audited version. GitHub requires a
dispatchable workflow registered on the default branch; if it is not registered
yet, obtain separate approval for that setup rather than adding a push trigger or
silently merging this branch. Example **after** registration/approval:

```bash
gh workflow run macos-release-signing.yml --repo BEATiFYAUDIO/contentbox --ref feat/macos-developer-id-notarization -f version=0.1.0-beta.12 -f environment_protection_confirmed=true
```

This example validates candidates only; it does not authorize a beta.12 release.
Inspect both native jobs. Hard gates include:

```bash
python3 scripts/macos-release.py verify-app '/path/Certifyd Core.app' --arch arm64 --version 0.1.0-beta.12
codesign --verify --strict --deep '/path/Certifyd Core.app'
spctl --assess --type execute --verbose=4 '/path/Certifyd Core.app'
codesign --verify --strict '/path/Certifyd-Core-0.1.0-beta.12-macos-arm64.dmg'
hdiutil verify '/path/Certifyd-Core-0.1.0-beta.12-macos-arm64.dmg'
xcrun stapler validate '/path/Certifyd-Core-0.1.0-beta.12-macos-arm64.dmg'
spctl --assess --type open --context context:primary-signature --verbose=4 '/path/Certifyd-Core-0.1.0-beta.12-macos-arm64.dmg'
```

Equivalent x64 checks are mandatory. CI also checks every inventoried Mach-O,
entitlements, target Node/launcher/Prisma architecture, dashboard/assets, launch,
health, dashboard, stop/status, restart/persistence, moved app, native addon/JIT,
blocked system Git/Node/npm, and private-LAN/public-listener separation.

`signing-logs/notary-submit.json` records the submission ID/status;
`notary-log.json` retains Apple's issues, including warnings on accepted builds.
Rejection, timeout, missing ticket, signature failure or Gatekeeper rejection fails
the job and prevents DMG upload. Logs still upload; a timed-out submission may need
later `notarytool info/log` with the same protected credentials. Do not resubmit
blindly or expose the key while collecting diagnostics. See
[Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

Still required before public promotion: a browser-downloaded/quarantined DMG on a
clean Mac, drag to Applications, normal double-click, online and offline ticket
behavior, and LAN helper behavior. Runner `spctl` checks are not a substitute for
that user-install test. Do not bypass Gatekeeper, strip quarantine, or change
security settings to call a candidate successful.
