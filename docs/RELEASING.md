# Certifyd Core Release Process

This document defines how public Certifyd Core installer releases should be organized.

## Public Release Model

GitHub Actions are for temporary build and validation artifacts.

GitHub Releases are the public installer archive.

Use one GitHub Release per public version. Old releases remain available for rollback and history. Do not silently replace a published binary with a different binary under the same version.

During beta, publish public installer sets as GitHub prereleases.

## Versioning

Use one version across all supported platform packages in a public release.

Example:

```text
0.1.0-beta.8
v0.1.0-beta.8
```

Do not publish a public release with mixed internal package labels. If build/test artifacts were produced with inconsistent labels, rebuild from the audited source and release-build state instead of renaming files blindly.

## Required Public Assets

Each public release should include the five supported platform artifacts:

```text
Certifyd-Core-Setup-<version>-win-x64.exe
Certifyd-Core-<version>-linux-x64.tar.gz
Certifyd-Core-<version>-linux-arm64.tar.gz
Certifyd-Core-<version>-macos-arm64.dmg
Certifyd-Core-<version>-macos-x64.dmg
```

Optional but recommended:

```text
SHA256SUMS.txt
```

The release notes must include SHA-256 hashes when `SHA256SUMS.txt` is not attached.

## Build Source

Build all five packages from one audited source commit plus only the minimum release-build metadata needed to produce the selected version labels.

For each package, record:

- source commit
- workflow run URL
- platform and architecture
- filename
- file size
- SHA-256
- bundled Node version
- Prisma version/engine target where available

## Validation Gate

Before publishing a public release, each package should pass the existing platform validation workflow for its native target.

At minimum, validate:

- build succeeds
- package filename uses the release version
- package launches
- `/health` responds
- dashboard responds
- stop/status path works where packaged
- restart/persistence works
- existing user data is preserved
- LAN Access launcher/entry point is present
- LAN mode does not set `CONTENTBOX_BIND=public`
- package does not require system Git, Node.js, npm, or manual Prisma commands

## LAN / Public Listener Invariants

Default mode:

- `:4000` remains localhost-only.

LAN Access mode:

- uses `CONTENTBOX_PRIVATE_BIND=public`
- preserves and extends `CONTENTBOX_PRIVATE_ALLOWED_HOSTS`
- may set `APP_BASE_URL` to the detected LAN address
- does not set `CONTENTBOX_BIND=public`

Public/tunnel exposure:

- uses the separate `:4010` listener
- remains controlled separately from LAN administration

## Publish Steps

1. Confirm the intended next version from existing tags and releases.
2. Build all five platform packages from the audited source/release-build commit.
3. Confirm filenames and internal version metadata.
4. Compute SHA-256 hashes.
5. Create a GitHub prerelease while Core is in beta.
6. Attach exactly the five platform assets, plus `SHA256SUMS.txt` if generated.
7. Include concise release notes with the source commit, validation summary, and SHA-256 hashes.
8. Verify the public asset URLs resolve.
9. Update `https://certifyd.me/downloads/`.
10. Update `https://vassal.certifyd.me/downloads/` if the Vassal site mirrors Core downloads.
11. Verify live download buttons on both sites.

## Historical Notes

The earliest public beta release, `v0.1.0-beta`, contains mixed package labels across platforms. That historical release should not be rewritten. Use later releases and this document as the forward convention.

As of `v0.1.0-beta.8`, the public release contains one coherent five-platform package set with consistent `0.1.0-beta.8` filenames.
