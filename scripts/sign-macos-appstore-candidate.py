#!/usr/bin/env python3
"""Ad-hoc sandbox signing for CI only; this is not App Store distribution signing."""
import json
from pathlib import Path
import subprocess
import sys

from importlib.machinery import SourceFileLoader

root = Path(__file__).resolve().parent.parent
release = SourceFileLoader("macos_release", str(root / "scripts/macos-release.py")).load_module()


def run(*args):
    subprocess.run(args, check=True)


def main(app: Path):
    app = app.resolve(strict=True)
    node = app / release.NODE
    launcher = app / release.LAUNCHER
    entitlements = root / "packaging/macos/app-store-candidate.entitlements.plist"
    node_entitlements = root / "packaging/macos/app-store-node.entitlements.plist"
    marker = app / "Contents/Resources/app-store-candidate"
    marker.write_text("CI validation only; no App Store signature or submission.\n")
    rows = release.inventory(app)
    for row in sorted(rows, key=lambda row: (-len(Path(row["path"]).parts), row["path"])):
        path = app / row["path"]
        args = ["/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime"]
        if path == node:
            args += ["--entitlements", str(node_entitlements)]
        elif path == launcher:
            args += ["--entitlements", str(entitlements)]
        run(*args, str(path))
    for bundle in sorted(release.nested_bundles(app), key=lambda path: -len(path.parts)):
        run("/usr/bin/codesign", "--force", "--sign", "-", str(bundle))
    run("/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime",
        "--entitlements", str(entitlements), str(app))
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
    print(json.dumps({"app": str(app), "macho_count": len(rows), "signature": "ad-hoc sandbox"}))


if __name__ == "__main__":
    if sys.platform != "darwin" or len(sys.argv) != 2:
        sys.exit("Usage (macOS only): sign-macos-appstore-candidate.py path/to/Certifyd Core.app")
    main(Path(sys.argv[1]))
