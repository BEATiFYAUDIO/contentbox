param(
  [Parameter(Mandatory = $true)][string]$Beta22Installer,
  [Parameter(Mandatory = $true)][string]$CandidateInstaller
)

$ErrorActionPreference = "Stop"
$env:CERTIFYD_LAUNCHER_NO_UI = "1"
$env:CERTIFYD_NO_BROWSER = "1"
$env:LOCALAPPDATA = Join-Path $env:RUNNER_TEMP "AudienceUpgradeLocalAppData"
$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$installDir = Join-Path $env:RUNNER_TEMP "Certifyd Audience Upgrade App"
$dbPath = Join-Path $dataRoot "contentbox.db"
$email = "audience-upgrade@example.test"
$password = "Audience-" + [guid]::NewGuid().ToString("N")

function Install-Core([string]$installer) {
  $installerArgs = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/DIR=`"$installDir`"", "/TASKS=desktopicon")
  $process = Start-Process -FilePath $installer -ArgumentList $installerArgs -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
}

function Wait-ForCore {
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    try {
      if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4000/health" -TimeoutSec 2).StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 750
  }
  throw "Installed Core did not become healthy."
}

function Start-Core {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir "launcher\CertifydCore.Launcher.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Installed launcher failed." }
  Wait-ForCore
}

function Stop-Core {
  $stop = Join-Path $installDir "launcher\CertifydCore.Stop.ps1"
  if (Test-Path $stop) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stop
    if ($LASTEXITCODE -ne 0) { throw "Installed Core did not stop cleanly." }
  }
}

function Invoke-Login {
  $body = @{ email = $email; password = $password } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/auth/login" -ContentType "application/json" -Body $body
}

try {
  Install-Core $Beta22Installer
  New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot "config"), (Join-Path $dataRoot "receipts") | Out-Null
  @(
    "DB_MODE=basic",
    "CONTENTBOX_ROOT=$dataRoot",
    "DATABASE_URL=file:$($dbPath.Replace('\', '/'))",
    "CONTENTBOX_PRIVATE_BIND=local",
    "CONTENTBOX_BIND=local",
    "CONTENTBOX_PRIVATE_ALLOWED_HOSTS=127.0.0.1,localhost",
    "PUBLIC_MODE=off",
    "PORT=4000",
    "PUBLIC_PORT=4010",
    "APP_BASE_URL=http://127.0.0.1:4000",
    "JWT_SECRET=ci-only-disposable-audience-upgrade-secret"
  ) | Set-Content -Path (Join-Path $dataRoot "config\api.env") -Encoding UTF8
  Start-Core
  $signup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/auth/signup" -ContentType "application/json" -Body (@{ email = $email; password = $password; displayName = "Synthetic Upgrade Creator" } | ConvertTo-Json -Compress)
  if (-not $signup.user.id) { throw "Beta 22 signup failed." }
  if ((Invoke-Login).user.id -ne $signup.user.id) { throw "Beta 22 normal login failed." }
  "Beta 22 normal signup/login=PASS"
  Stop-Core
  $configBefore = (Get-FileHash (Join-Path $dataRoot "config\api.env") -Algorithm SHA256).Hash

  # Seed only synthetic commerce records in the runner's disposable SQLite database.
  $env:DATABASE_URL = "file:$($dbPath.Replace('\', '/'))"
  $env:CORE_API_DIR = Join-Path $installDir "apps\api"
  $env:TEST_USER_ID = [string]$signup.user.id
  $fixtureJs = Join-Path $env:RUNNER_TEMP "audience-upgrade-commerce.js"
  @'
const path = require('path');
const { PrismaClient } = require(path.join(process.env.CORE_API_DIR, 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const userId = process.env.TEST_USER_ID;
const workId = 'audience-upgrade-synthetic-work';
const intentId = 'audience-upgrade-synthetic-intent';
async function main() {
  if (process.argv[2] === 'seed') {
    await prisma.contentItem.create({ data: { id: workId, ownerUserId: userId, title: 'Synthetic upgrade work', type: 'song', status: 'published' } });
    await prisma.paymentIntent.create({ data: { id: intentId, contentId: workId, amountSats: 1000n, status: 'paid', purpose: 'CONTENT_PURCHASE', subjectType: 'CONTENT', subjectId: workId, receiptId: 'audience-upgrade-synthetic-receipt', paidAt: new Date('2024-01-02T00:00:00Z') } });
    await prisma.entitlement.create({ data: { id: 'audience-upgrade-synthetic-entitlement', buyerUserId: userId, contentId: workId, manifestSha256: 'a'.repeat(64), paymentIntentId: intentId } });
    await prisma.sale.create({ data: { id: 'audience-upgrade-synthetic-sale', intentId, contentId: workId, sellerUserId: userId, amountSats: 1000n, rail: 'synthetic', recognizedAt: new Date('2024-01-02T00:00:00Z') } });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const work = await prisma.contentItem.findUnique({ where: { id: workId } });
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  const entitlement = await prisma.entitlement.findUnique({ where: { id: 'audience-upgrade-synthetic-entitlement' } });
  const sale = await prisma.sale.findUnique({ where: { id: 'audience-upgrade-synthetic-sale' } });
  if (user?.email !== 'audience-upgrade@example.test' || work?.ownerUserId !== userId ||
      intent?.receiptId !== 'audience-upgrade-synthetic-receipt' || intent?.status !== 'paid' ||
      intent?.amountSats !== 1000n || entitlement?.paymentIntentId !== intentId ||
      sale?.intentId !== intentId || sale?.amountSats !== 1000n) {
    throw new Error('Synthetic creator or commerce records changed.');
  }
  console.log('Synthetic profile, work, paid purchase, receipt ID, entitlement and sale=PASS');
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
'@ | Set-Content -Path $fixtureJs -Encoding UTF8
  & (Join-Path $installDir "runtime\node\node.exe") $fixtureJs seed
  if ($LASTEXITCODE -ne 0) { throw "Could not seed or verify Beta 22 synthetic commerce." }
  Set-Content -Path (Join-Path $dataRoot "receipts\audience-upgrade-synthetic-receipt.json") -Value '{"synthetic":true}' -Encoding UTF8
  $receiptHash = (Get-FileHash (Join-Path $dataRoot "receipts\audience-upgrade-synthetic-receipt.json") -Algorithm SHA256).Hash

  Install-Core $CandidateInstaller
  if ((Get-FileHash (Join-Path $dataRoot "config\api.env") -Algorithm SHA256).Hash -ne $configBefore) { throw "Existing configuration changed during upgrade." }
  if ((Get-FileHash (Join-Path $dataRoot "receipts\audience-upgrade-synthetic-receipt.json") -Algorithm SHA256).Hash -ne $receiptHash) { throw "Existing receipt file changed during upgrade." }
  Start-Core
  $login = Invoke-Login
  if ($login.user.id -ne $signup.user.id -or -not $login.token) { throw "Existing creator cannot log in after upgrade." }
  "Existing creator normal login after upgrade=PASS"
  & (Join-Path $installDir "runtime\node\node.exe") $fixtureJs verify
  if ($LASTEXITCODE -ne 0) { throw "Commerce records failed post-upgrade verification." }
  $summary = Invoke-RestMethod -Uri "http://127.0.0.1:4000/audience/summary?range=all&page=1" -Headers @{ Authorization = "Bearer $($login.token)" }
  if (-not $summary.metadata -or $summary.metadata.viewCoverage -ne "incomplete") { throw "Existing account historical coverage was not reported honestly." }
  "Audience upgrade coverage=PASS"
  "Configuration and receipt file preservation=PASS"
  "Disposable Windows existing-user upgrade=PASS"
} finally {
  Stop-Core
}
