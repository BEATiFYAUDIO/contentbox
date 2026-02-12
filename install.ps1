Param(
  [switch]$Lan
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Error "[install] $msg"
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Missing required command: node" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "Missing required command: npm" }

Write-Host "[install] Node: $(node -v)"
Write-Host "[install] npm:  $(npm -v)"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir = Join-Path $root "apps/api"
$dashDir = Join-Path $root "apps/dashboard"

$apiEnv = Join-Path $apiDir ".env"
$apiEnvExample = Join-Path $apiDir ".env.example"
$dashEnv = Join-Path $dashDir ".env"
$dashEnvExample = Join-Path $dashDir ".env.example"

if (-not (Test-Path $apiEnv)) {
  if (-not (Test-Path $apiEnvExample)) { Fail "Missing $apiEnvExample" }
  Copy-Item $apiEnvExample $apiEnv
  Write-Host "[install] Created $apiEnv from example."
  Write-Host "[install] Edit $apiEnv (DATABASE_URL, JWT_SECRET, CONTENTBOX_ROOT), then re-run."
  exit 1
}

if (-not (Test-Path $dashEnv)) {
  if (-not (Test-Path $dashEnvExample)) { Fail "Missing $dashEnvExample" }
  Copy-Item $dashEnvExample $dashEnv
  Write-Host "[install] Created $dashEnv from example."
  Write-Host "[install] Edit $dashEnv if API is not localhost."
}

if ($Lan) {
  $content = Get-Content $apiEnv -ErrorAction SilentlyContinue
  if ($content -match "^CONTENTBOX_BIND=") {
    $content = $content -replace "^CONTENTBOX_BIND=.*", "CONTENTBOX_BIND=public"
    Set-Content -Path $apiEnv -Value $content
  } else {
    Add-Content -Path $apiEnv -Value "CONTENTBOX_BIND=public"
  }
  Write-Host "[install] LAN mode enabled (CONTENTBOX_BIND=public)."
  Write-Host "[install] If LAN access fails, allow tcp/4000 in your firewall."
}

Push-Location $apiDir
npm install
npx prisma validate
npx prisma generate
Pop-Location

Push-Location $dashDir
npm install
Pop-Location

Write-Host "[install] Next steps:"
Write-Host "  Terminal 1: cd apps/api && npm run dev"
Write-Host "  Terminal 2: cd apps/dashboard && npm run dev"
Write-Host "  API: http://127.0.0.1:4000"
Write-Host "  Dashboard: http://127.0.0.1:5173"
