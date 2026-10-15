import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const launcher = readFileSync(path.join(repoRoot, "packaging/windows/CertifydCore.Launcher.ps1"), "utf8");
const linuxLauncher = readFileSync(path.join(repoRoot, "packaging/linux/start.sh"), "utf8");
const windowsControl = readFileSync(path.join(repoRoot, "packaging/windows/CertifydCore.Control.ps1"), "utf8");
const windowsFirewall = readFileSync(path.join(repoRoot, "packaging/windows/CertifydCore.Firewall.ps1"), "utf8");

test("Windows installed launcher gives visible failures and serializes repeated launches", () => {
  assert.doesNotMatch(launcher, /\$host\s*=/i, "PowerShell's read-only $Host automatic variable must not be assigned");
  assert.match(launcher, /function Show-LaunchFailure/);
  assert.match(launcher, /WScript\.Shell/);
  assert.match(launcher, /Certifyd Core could not start/);
  assert.match(launcher, /Local\\CertifydCoreLauncher/);
  assert.match(launcher, /WaitOne\(\[TimeSpan\]::FromSeconds\(120\)\)/);
  assert.match(launcher, /System\.Threading\.AbandonedMutexException/);
  assert.match(launcher, /function Release-LauncherLock/);
  assert.match(launcher, /ReleaseMutex\(\)/);
  assert.match(launcher, /function Test-CoreProcess/);
  assert.match(launcher, /ExecutablePath/);
  assert.match(launcher, /src\[\\\\\/\]server\\\.ts/);
  assert.match(launcher, /The Core process is running but did not become healthy/);
  assert.doesNotMatch(
    launcher,
    /if \(\$null -ne \$existing\) \{\s*Start-Process \(\[string\]\$envValues\["APP_BASE_URL"\]\)/
  );
});

test("Windows installed launcher avoids duplicate initialization and opens only a healthy dashboard", () => {
  const firstHealth = launcher.indexOf("if (Test-Health)");
  const startupFeedback = launcher.indexOf('Set-LauncherStatus "Validating local data..."', firstHealth);
  const prismaValidate = launcher.indexOf("Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, \"validate\"");

  assert.ok(firstHealth >= 0, "launcher must check an existing healthy Core");
  assert.ok(prismaValidate > firstHealth, "healthy repeat launch must bypass Prisma and process startup");
  assert.ok(startupFeedback > firstHealth && startupFeedback < prismaValidate, "cold startup must show feedback before Prisma work");
  assert.equal((launcher.match(/-ArgumentList @\(\"--import\", \"tsx\", \"src\/server\.ts\"\)/g) || []).length, 1);
  assert.match(launcher, /if \(Wait-ForCoreHealth 45 \$process\) \{\s*Set-LauncherStatus[^\n]+\s*Open-Dashboard/);
  assert.match(launcher, /CERTIFYD_NO_BROWSER/);
  assert.match(launcher, /function Start-LauncherSplash/);
  assert.match(launcher, /assets\\certifyd-core\.png/);
  assert.match(launcher, /Retry/);
  assert.match(launcher, /View Logs/);
  assert.doesNotMatch(launcher, /cloudflared|taskkill\.exe|Stop-Service|Restart-Service/i);
});

test("Windows controller remains available through startup failure and limits LAN firewall access", () => {
  assert.match(windowsControl, /NotifyIcon/);
  assert.match(windowsControl, /View Logs/);
  assert.match(windowsControl, /Enable or Refresh LAN Access/);
  assert.match(windowsControl, /FirstRunQuick/);
  assert.doesNotMatch(windowsControl, /taskkill|Stop-Service|pkill|killall/i);
  assert.match(windowsFirewall, /-Profile Private/);
  assert.match(windowsFirewall, /-Program/);
  assert.match(windowsFirewall, /-LocalPort/);
});

test("packaged launchers persist consented first-run Quick mode without overriding existing OFF", () => {
  for (const source of [launcher, linuxLauncher]) {
    assert.match(source, /FirstRunQuick|FIRST_RUN_QUICK/);
    assert.match(source, /newInstallAtLaunch|new_install_at_launch/);
    assert.match(source, /publicSharingConsent/);
    assert.match(source, /publicSharingAutoStart/);
  }
});

test("Linux packaged launcher serializes startup, validates process identity, and skips duplicate initialization", () => {
  const firstHealth = linuxLauncher.indexOf("if check_health; then");
  const prismaValidate = linuxLauncher.indexOf('"$node_bin" "$prisma_cli" validate');

  assert.match(linuxLauncher, /launcher\.lock/);
  assert.match(linuxLauncher, /acquire_launcher_lock/);
  assert.match(linuxLauncher, /release_launcher_lock/);
  assert.match(linuxLauncher, /is_core_process/);
  assert.match(linuxLauncher, /ps -p "\$pid" -o command=/);
  assert.match(linuxLauncher, /wait_for_core_health 45 "\$started_pid"/);
  assert.match(linuxLauncher, /CERTIFYD_NO_BROWSER/);
  assert.match(linuxLauncher, /zenity --progress --pulsate/);
  assert.match(linuxLauncher, /--ok-label="Retry" --cancel-label="View Logs"/);
  assert.match(linuxLauncher, /assets\/certifyd-core\.png/);
  assert.ok(firstHealth >= 0, "launcher must check an existing healthy Core");
  assert.ok(prismaValidate > firstHealth, "healthy repeat launch must bypass Prisma and process startup");
  assert.equal((linuxLauncher.match(/nohup "\$node_bin" --import tsx src\/server\.ts/g) || []).length, 1);
  assert.doesNotMatch(linuxLauncher, /xdg-open "\$app_url" >\/dev\/null 2>&1 \|\| true/);
  assert.doesNotMatch(linuxLauncher, /cloudflared|pkill|killall/i);
});

test("Linux stop and status scripts reject stale unrelated PIDs", () => {
  for (const name of ["stop.sh", "status.sh"]) {
    const source = readFileSync(path.join(repoRoot, "packaging/linux", name), "utf8");
    assert.match(source, /is_core_process/);
    assert.match(source, /src\/server\.ts/);
    assert.match(source, /ps -p "\$pid" -o command=/);
  }
});

test("Windows and macOS stop and status scripts reject stale unrelated PIDs", () => {
  for (const [platform, names] of [
    ["windows", ["CertifydCore.Stop.ps1", "CertifydCore.Status.ps1"]],
    ["macos", ["stop.sh", "status.sh"]]
  ] as const) {
    for (const name of names) {
      const source = readFileSync(path.join(repoRoot, "packaging", platform, name), "utf8");
      assert.match(source, /Test-CoreProcess|is_core_process/);
      assert.match(source, /src\[|src\/server\.ts/);
    }
  }
});
