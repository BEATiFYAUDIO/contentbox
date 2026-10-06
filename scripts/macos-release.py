#!/usr/bin/env python3
"""macOS release gates. No signing credentials are read or logged here."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

IDENTITY = "Developer ID Application: Hwy 11 Entertainment Inc (KYAPD65KRD)"
TEAM = "KYAPD65KRD"
NODE = Path("Contents/Resources/runtime/node/bin/node")
LAUNCHER = Path("Contents/MacOS/CertifydCoreLauncher")
JIT = {"com.apple.security.cs.allow-jit": True}
MAGICS = {bytes.fromhex(x) for x in (
    "feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")}


def run(*args):
    return subprocess.check_output([str(a) for a in args], stderr=subprocess.STDOUT).decode()


def versions(version):
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta(?:\.([1-9]\d*))?)?", version)
    if not match:
        raise ValueError("Expected X.Y.Z, X.Y.Z-beta, or X.Y.Z-beta.N")
    major, minor, patch = map(int, match.group(1, 2, 3))
    iteration = int(match.group(4) or 0) if "-beta" in version else 99
    if major > 98 or minor > 99 or patch > 99 or ("-beta" in version and iteration > 98):
        raise ValueError("Apple version mapping supports major<=98, minor/patch<=99, beta<=98")
    # Apple numeric 4.2.2 digit limits; reserve 99 for the stable release.
    return f"{major}.{minor}.{patch}", f"{major * 100 + minor + 1}.{patch}.{iteration}"


def require_notarized(submission, log, submit_status):
    if submit_status != 0 or submission.get("status") != "Accepted" or log.get("status") != "Accepted":
        raise ValueError("Apple did not accept this DMG")
    if not submission.get("id") or submission["id"] != log.get("jobId"):
        raise ValueError("Notarization log does not match the submission")


def inventory(app):
    app = app.resolve(strict=True)
    found = []
    for path in sorted(app.rglob("*")):
        if path.is_symlink():
            if not path.resolve(strict=True).is_relative_to(app):
                raise ValueError(f"Symlink escapes app: {path.relative_to(app)}")
            continue
        if not path.is_file():
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic not in MAGICS:
            continue
        description = run("/usr/bin/file", "-b", path).strip()
        if "Mach-O" not in description:  # CAFEBABE can also be a Java class.
            continue
        found.append({"path": str(path.relative_to(app)), "file": description,
                      "architectures": run("/usr/bin/lipo", "-archs", path).strip().split()})
    if not found:
        raise ValueError("No Mach-O code in app")
    return found


def validate_layout(app, arch, version):
    short, build = versions(version)
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    expected = {"CFBundleIdentifier": "me.certifyd.core", "CFBundleExecutable": LAUNCHER.name,
                "CFBundleShortVersionString": short, "CFBundleVersion": build}
    for key, value in expected.items():
        if info.get(key) != value:
            raise ValueError(f"Incorrect {key}: expected {value}")
    for relative in [NODE, LAUNCHER, Path("Contents/Resources/CertifydCore.icns"),
                     Path("Contents/Resources/CertifydCoreLauncher.sh"),
                     Path("Contents/Resources/app/apps/dashboard/dist/index.html"),
                     Path("Contents/Resources/app/apps/api/node_modules/.prisma/client/index.js")]:
        if not (app / relative).is_file():
            raise ValueError(f"Missing required resource: {relative}")
    for path in app.rglob("*"):
        if path.name == ".env" or path.name.startswith(".env.") or path.suffix.lower() in {".p12", ".p8", ".pfx", ".key"}:
            raise ValueError(f"Forbidden packaged file: {path.relative_to(app)}")
    rows = inventory(app)
    expected_arch = "x86_64" if arch == "x64" else "arm64"
    for relative in (NODE, LAUNCHER):
        matches = [r for r in rows if r["path"] == str(relative)]
        if len(matches) != 1 or matches[0]["architectures"] != [expected_arch]:
            raise ValueError(f"Wrong native architecture: {relative}")
    engine_target = "darwin" if arch == "x64" else "darwin-arm64"
    engines = [r for r in rows if Path(r["path"]).name == f"libquery_engine-{engine_target}.dylib.node"]
    if not engines or any(r["architectures"] != [expected_arch] for r in engines):
        raise ValueError("Missing or wrong-architecture target Prisma query engine")
    return rows


def nested_bundles(app):
    # Sign any future nested bundles after their contents, before their parent.
    return [p for p in app.rglob("*") if p.is_dir() and not p.is_symlink()
            and p.suffix in {".app", ".framework", ".xpc", ".appex", ".bundle"}]


def verify_signature(path, executable=False, entitlements=None, architecture=None):
    run("/usr/bin/codesign", "--verify", "--strict", "--all-architectures", path)
    arch_args = ["--arch", architecture] if architecture else []
    metadata = run("/usr/bin/codesign", "-d", "--verbose=4", *arch_args, path)
    for required in (f"Authority={IDENTITY}", f"TeamIdentifier={TEAM}", "Timestamp="):
        if not any(line == required if not required.endswith('=') else line.startswith(required) and line[len(required):].strip()
                   for line in metadata.splitlines()):
            raise ValueError(f"Missing {required} on {path}")
    if executable and not re.search(r"flags=.*\bruntime\b", metadata):
        raise ValueError(f"Hardened Runtime missing: {path}")
    if entitlements is not None:
        raw = run("/usr/bin/codesign", "-d", "--entitlements", ":-", *arch_args, path)
        start = raw.find("<?xml")
        end = raw.find("</plist>")
        actual = plistlib.loads(raw[start:end + len("</plist>")].encode()) if start >= 0 and end >= 0 else {}
        if actual != entitlements:
            raise ValueError(f"Unexpected entitlements on {path}: {sorted(actual)}")


def verify_app(app, arch, version):
    rows = validate_layout(app, arch, version)
    for row in rows:
        relative = Path(row["path"])
        for architecture in row["architectures"]:
            verify_signature(app / relative, "executable" in row["file"], JIT if relative == NODE else {}, architecture)
    for bundle in nested_bundles(app):
        verify_signature(bundle, entitlements={})
    verify_signature(app, executable=True, entitlements={})
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", app)
    return rows


def sign_app(app, arch, version, keychain):
    rows = validate_layout(app, arch, version)
    entitlements = Path(__file__).resolve().parent.parent / "packaging/macos/node-entitlements.plist"
    if plistlib.loads(entitlements.read_bytes()) != JIT:
        raise ValueError("Unexpected Node entitlements")
    paths = [app / row["path"] for row in rows] + nested_bundles(app)
    for path in sorted(set(paths), key=lambda p: (-len(p.parts), str(p))):
        args = ["/usr/bin/codesign", "--force", "--sign", IDENTITY, "--keychain", keychain,
                "--timestamp", "--options", "runtime"]
        if path == app / NODE:
            args += ["--entitlements", str(entitlements)]
        run(*args, path)
    run("/usr/bin/codesign", "--force", "--sign", IDENTITY, "--keychain", keychain,
        "--timestamp", "--options", "runtime", app)
    return verify_app(app, arch, version)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["versions", "notary-result", "inventory", "sign-app", "verify-app", "sign-dmg", "verify-dmg"])
    parser.add_argument("path", nargs="?", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--arch", choices=["x64", "arm64"])
    parser.add_argument("--keychain")
    parser.add_argument("--log", type=Path)
    parser.add_argument("--submit-status", type=int)
    args = parser.parse_args()
    if args.command == "versions":
        print(" ".join(versions(args.version)))
        return
    if args.command == "notary-result":
        submission = json.loads(args.path.read_text())
        log = json.loads(args.log.read_text())
        print("Notarization status:", submission.get("status"))
        for issue in log.get("issues") or []:
            print(json.dumps(issue))
        require_notarized(submission, log, args.submit_status)
        return
    if sys.platform != "darwin":
        raise ValueError("Apple code-signing validation requires macOS")
    path = args.path.resolve(strict=True)
    if args.command == "inventory":
        print(json.dumps(validate_layout(path, args.arch, args.version), indent=2))
    elif args.command == "sign-app":
        print(json.dumps(sign_app(path, args.arch, args.version, args.keychain), indent=2))
    elif args.command == "verify-app":
        print(json.dumps(verify_app(path, args.arch, args.version), indent=2))
    else:
        if args.command == "sign-dmg":
            run("/usr/bin/codesign", "--force", "--sign", IDENTITY, "--keychain", args.keychain, "--timestamp", path)
        verify_signature(path)
        run("/usr/bin/hdiutil", "verify", path)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.output.decode() if isinstance(error.output, bytes) else error.output, file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
