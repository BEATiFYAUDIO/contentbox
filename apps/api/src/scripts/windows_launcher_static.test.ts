import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const launcher = readFileSync(path.join(repoRoot, "packaging/windows/CertifydCore.Launcher.ps1"), "utf8");

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
