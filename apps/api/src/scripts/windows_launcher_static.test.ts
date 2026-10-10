import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const launcher = readFileSync(path.join(repoRoot, "packaging/windows/CertifydCore.Launcher.ps1"), "utf8");
const linuxLauncher = readFileSync(path.join(repoRoot, "packaging/linux/start.sh"), "utf8");

test("Windows installed launcher gives visible failures and serializes repeated launches", () => {
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
  const startingNotice = launcher.indexOf("Show-StartingNotice", firstHealth);
  const prismaValidate = launcher.indexOf("Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, \"validate\"");

  assert.ok(firstHealth >= 0, "launcher must check an existing healthy Core");
  assert.ok(prismaValidate > firstHealth, "healthy repeat launch must bypass Prisma and process startup");
  assert.ok(startingNotice > firstHealth && startingNotice < prismaValidate, "cold startup must show feedback before Prisma work");
  assert.equal((launcher.match(/-ArgumentList @\(\"--import\", \"tsx\", \"src\/server\.ts\"\)/g) || []).length, 1);
  assert.match(launcher, /if \(Wait-ForCoreHealth 45 \$process\) \{\s*Open-Dashboard/);
  assert.match(launcher, /CERTIFYD_NO_BROWSER/);
  assert.doesNotMatch(launcher, /cloudflared|taskkill\.exe|Stop-Service|Restart-Service/i);
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
