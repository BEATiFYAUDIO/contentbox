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

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "[install] cloudflared not found in PATH."
  Write-Host "[install] Public Link can download a managed helper tool after you approve the prompt."
  Write-Host "[install] (Optional) You can still install cloudflared system-wide if preferred."
}

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
  Write-Host "[install] Edit $apiEnv (DATABASE_URL) if needed."
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

function Set-EnvLine($path, $key, $value) {
  $lines = Get-Content $path
  if ($lines -match "^$key=") {
    $lines = $lines -replace "^$key=.*", "$key=$value"
    Set-Content -Path $path -Value $lines
  } else {
    Add-Content -Path $path -Value "$key=$value"
  }
}

$envText = Get-Content $apiEnv -ErrorAction SilentlyContinue
if (-not ($envText -match "^DATABASE_URL=")) { Fail "DATABASE_URL is missing in $apiEnv" }

if (-not ($envText -match "^JWT_SECRET=") -or ($envText -match "^JWT_SECRET=change-me")) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $jwt = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  Set-EnvLine $apiEnv "JWT_SECRET" $jwt
  Write-Host "[install] Generated JWT_SECRET."
}

if (-not ($envText -match "^CONTENTBOX_ROOT=")) {
  $rootPath = Join-Path $HOME "contentbox-data"
  Set-EnvLine $apiEnv "CONTENTBOX_ROOT" "`"$rootPath`""
  Write-Host "[install] Set CONTENTBOX_ROOT to $rootPath"
}

if (-not ($envText -match "^PUBLIC_MODE=")) {
  Set-EnvLine $apiEnv "PUBLIC_MODE" "quick"
  Write-Host "[install] Set PUBLIC_MODE=quick (default)."
}

function Prompt-InstallCloudflared {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) { return }

  $rootLine = (Get-Content $apiEnv | Where-Object { $_ -match "^CONTENTBOX_ROOT=" } | Select-Object -First 1)
  if (-not $rootLine) { return }
  $rootVal = $rootLine -replace "^CONTENTBOX_ROOT=", ""
  $rootVal = $rootVal.Trim('"')
  if (-not $rootVal) { return }

  $binDir = Join-Path $rootVal ".bin"
  $dest = Join-Path $binDir "cloudflared.exe"
  if (Test-Path $dest) { return }

  Write-Host ""
  Write-Host "Public Link helper tool (optional)"
  Write-Host "This will download a small helper tool into:"
  Write-Host "  $binDir"
  Write-Host "It can be removed anytime."
  $ans = Read-Host "Download now? (y/N)"
  if ($ans -notmatch '^(y|Y|yes|YES)$') { return }

  New-Item -ItemType Directory -Force -Path $binDir | Out-Null

  $versionLine = (Get-Content $apiEnv | Where-Object { $_ -match "^CLOUDFLARED_VERSION=" } | Select-Object -First 1)
  $version = $versionLine -replace "^CLOUDFLARED_VERSION=", ""
  $version = $version.Trim('"')
  if (-not $version) { $version = "latest" }
  if ($version -eq "latest") {
    $base = "https://github.com/cloudflare/cloudflared/releases/latest/download"
  } else {
    $base = "https://github.com/cloudflare/cloudflared/releases/download/$version"
  }

  $arch = (Get-CimInstance Win32_OperatingSystem).OSArchitecture
  $url = ""
  if ($arch -match "64") {
    $url = "$base/cloudflared-windows-amd64.exe"
  }
  if (-not $url) {
    Write-Host "[install] Unsupported platform/arch for cloudflared download."
    return
  }

  Write-Host "[install] Downloading helper tool..."
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing | Out-Null
  } catch {
    Write-Host "[install] Download failed."
    return
  }

  $stateFile = Join-Path $rootVal "state.json"
  $consent = @{
    publicSharingConsent = @{
      granted = $true
      dontAskAgain = $true
      grantedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    publicSharingAutoStart = $false
  }
  if (Test-Path $stateFile) {
    try {
      $existing = Get-Content $stateFile | ConvertFrom-Json
      $existing.publicSharingConsent = $consent.publicSharingConsent
      $existing.publicSharingAutoStart = $false
      $existing | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
    } catch {
      $consent | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
    }
  } else {
    $consent | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
  }

  Write-Host "[install] Helper tool installed."
}

Prompt-InstallCloudflared

$envText = Get-Content $apiEnv -ErrorAction SilentlyContinue
$rootLine = ($envText | Where-Object { $_ -match "^CONTENTBOX_ROOT=" } | Select-Object -First 1)
if ($rootLine) {
  $rootVal = $rootLine -replace "^CONTENTBOX_ROOT=", ""
  $rootVal = $rootVal.Trim('"')
  if (-not (Test-Path $rootVal)) { New-Item -ItemType Directory -Force -Path $rootVal | Out-Null }
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
Write-Host "  Public server: http://127.0.0.1:4010 (PUBLIC_PORT)"
