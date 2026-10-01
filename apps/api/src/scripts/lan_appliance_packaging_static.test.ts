import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("LAN administration does not change the public listener bind variable", () => {
  const linuxInstall = read("install.sh");
  const windowsInstall = read("install.ps1");
  const windowsLauncher = read("packaging/windows/CertifydCore.Launcher.ps1");

  assert.doesNotMatch(linuxInstall, /CONTENTBOX_BIND"\s+"public"/);
  assert.doesNotMatch(windowsInstall, /CONTENTBOX_BIND"\s+"public"/);
  assert.doesNotMatch(windowsLauncher, /CONTENTBOX_BIND"\]\s*=\s*"public"/);
  assert.match(linuxInstall, /CONTENTBOX_PRIVATE_BIND"\s+"public"/);
  assert.match(windowsInstall, /CONTENTBOX_PRIVATE_BIND"\s+"public"/);
  assert.match(windowsLauncher, /CONTENTBOX_PRIVATE_BIND"\]\s*=\s*"public"/);
});

test("LAN mode preserves and merges private allowed hosts", () => {
  const files = [
    read("install.sh"),
    read("install.ps1"),
    read("packaging/linux/start.sh"),
    read("packaging/macos/CertifydCoreLauncher.sh"),
    read("packaging/windows/CertifydCore.Launcher.ps1"),
  ];

  for (const source of files) {
    assert.match(source, /Merge-HostLists|merge_host_lists/);
    assert.match(source, /CONTENTBOX_PRIVATE_ALLOWED_HOSTS/);
  }
});

test("source installers preserve existing persistent database configuration", () => {
  const linuxInstall = read("install.sh");
  const windowsInstall = read("install.ps1");

  assert.doesNotMatch(linuxInstall, /ROOT_VAL="\$REAL_HOME\/contentbox-data"/);
  assert.match(linuxInstall, /Preserving existing DB_MODE/);
  assert.match(windowsInstall, /Preserving existing DB_MODE/);
  assert.match(linuxInstall, /Preserving existing DATABASE_URL/);
  assert.match(windowsInstall, /Preserving existing DATABASE_URL/);
});

test("Windows packaged launcher preserves existing database configuration and defaults only placeholders", () => {
  const launcher = read("packaging/windows/CertifydCore.Launcher.ps1");

  assert.match(launcher, /function Test-UninitializedValue/);
  assert.match(launcher, /function Test-UninitializedDatabaseUrl/);
  assert.match(launcher, /file:\.\/contentbox\.db/);
  assert.match(launcher, /if \(-not \$envValues\.ContainsKey\("DB_MODE"\) -or \(Test-UninitializedValue \$envValues\["DB_MODE"\]\)\)/);
  assert.match(launcher, /if \(-not \$envValues\.ContainsKey\("CONTENTBOX_ROOT"\) -or \(Test-UninitializedValue \$envValues\["CONTENTBOX_ROOT"\]\)\)/);
  assert.match(launcher, /if \(-not \$envValues\.ContainsKey\("DATABASE_URL"\) -or \(Test-UninitializedDatabaseUrl \$envValues\["DATABASE_URL"\]\)\)/);
  assert.match(launcher, /\$contentboxRoot = \[string\]\$envValues\["CONTENTBOX_ROOT"\]/);
  assert.match(launcher, /\$dbPath = Join-Path \$contentboxRoot "contentbox\.db"/);
  assert.doesNotMatch(launcher, /\$envValues\["CONTENTBOX_ROOT"\] = \$dataRoot\s*\r?\n\$envValues\["DATABASE_URL"\] = "file:\$\(Normalize-FileUrlPath \$dbPath\)"/);
});

test("packaged users have discoverable LAN launch paths", () => {
  assert.match(read("packaging/linux/install-desktop.sh"), /Certifyd Core \(LAN Access\)/);
  assert.match(read("packaging/linux/install-desktop.sh"), /start\.sh --lan/);
  assert.match(read("packaging/windows/CertifydCore.iss"), /Certifyd Core \(LAN Access\)/);
  assert.match(read("packaging/windows/CertifydCore.iss"), /-Lan/);
  assert.match(read("scripts/build-macos-package.sh"), /Start Certifyd Core with LAN Access\.command/);
  assert.match(read("scripts/build-macos-package.sh"), /CertifydCoreLauncher" --lan/);
});

test("LAN host selection prefers default-route style helpers and filters virtual interfaces", () => {
  const files = [
    read("install.sh"),
    read("install.ps1"),
    read("packaging/linux/start.sh"),
    read("packaging/macos/CertifydCoreLauncher.sh"),
    read("packaging/windows/CertifydCore.Launcher.ps1"),
  ];

  for (const source of files) {
    assert.match(source, /detect_primary_lan_host|Get-PrimaryLanHost/);
    assert.match(source, /is_virtual_interface|Test-VirtualInterface/);
  }
});
