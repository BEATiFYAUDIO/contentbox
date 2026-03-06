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

Write-Output "[install] Node: $(node -v)"
Write-Output "[install] npm:  $(npm -v)"

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Output "[install] cloudflared not found in PATH."
  Write-Output "[install] Public Link can download a managed helper tool after you approve the prompt."
  Write-Output "[install] (Optional) You can still install cloudflared system-wide if preferred."
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
  Write-Output "[install] Created $apiEnv from example."
  Write-Output "[install] Edit $apiEnv (DATABASE_URL) if needed."
}

if (-not (Test-Path $dashEnv)) {
  if (-not (Test-Path $dashEnvExample)) { Fail "Missing $dashEnvExample" }
  Copy-Item $dashEnvExample $dashEnv
  Write-Output "[install] Created $dashEnv from example."
  Write-Output "[install] Set VITE_API_URL to localhost by default."
}

if ($Lan) {
  $content = Get-Content $apiEnv -ErrorAction SilentlyContinue
  if ($content -match "^CONTENTBOX_BIND=") {
    $content = $content -replace "^CONTENTBOX_BIND=.*", "CONTENTBOX_BIND=public"
    Set-Content -Path $apiEnv -Value $content
  } else {
    Add-Content -Path $apiEnv -Value "CONTENTBOX_BIND=public"
  }
  Write-Output "[install] LAN mode enabled (CONTENTBOX_BIND=public)."
  Write-Output "[install] If LAN access fails, allow tcp/4000 in your firewall."
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
  Write-Output "[install] Generated JWT_SECRET."
}

if (-not ($envText -match "^CONTENTBOX_ROOT=")) {
  $rootPath = Join-Path $HOME "contentbox-data"
  Set-EnvLine $apiEnv "CONTENTBOX_ROOT" "`"$rootPath`""
  Write-Output "[install] Set CONTENTBOX_ROOT to $rootPath"
}

if (-not ($envText -match "^PUBLIC_MODE=")) {
  Set-EnvLine $apiEnv "PUBLIC_MODE" "quick"
  Write-Output "[install] Set PUBLIC_MODE=quick (default)."
}

if (-not ($envText -match "^DB_MODE=")) {
  Set-EnvLine $apiEnv "DB_MODE" "basic"
  Write-Output "[install] Set DB_MODE=basic (default)."
}

$envText = Get-Content $apiEnv -ErrorAction SilentlyContinue
$dbModeLine = ($envText | Where-Object { $_ -match "^DB_MODE=" } | Select-Object -First 1)
$dbMode = ($dbModeLine -replace "^DB_MODE=", "").Trim()
if (-not $dbMode) { $dbMode = "basic" }

if ($dbMode -eq "basic") {
  $rootLine = ($envText | Where-Object { $_ -match "^CONTENTBOX_ROOT=" } | Select-Object -First 1)
  $rootVal = $rootLine -replace "^CONTENTBOX_ROOT=", ""
  $rootVal = $rootVal.Trim('"')
  if (-not $rootVal) { $rootVal = Join-Path $HOME "contentbox-data" }
  $sqliteUrl = "file:$rootVal/contentbox.db"
  Set-EnvLine $apiEnv "DATABASE_URL" "`"$sqliteUrl`""
  Write-Output "[install] Using SQLite for basic mode."
}

Set-EnvLine $dashEnv "VITE_API_URL" "http://127.0.0.1:4000"

function Prompt-InstallCloudflared {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) { return }

  $rootLine = (Get-Content $apiEnv | Where-Object { $_ -match "^CONTENTBOX_ROOT=" } | Select-Object -First 1)
  $rootVal = $rootLine -replace "^CONTENTBOX_ROOT=", ""
  $rootVal = $rootVal.Trim('"')
  if (-not $rootVal -or $rootVal -match "<user>") {
    $rootVal = Join-Path $HOME "contentbox-data"
    Set-EnvLine $apiEnv "CONTENTBOX_ROOT" "`"$rootVal`""
  }

  $binDir = Join-Path $rootVal ".bin"
  $dest = Join-Path $binDir "cloudflared.exe"
  if (Test-Path $dest) { return }

  Write-Output ""
  Write-Output "Public Link helper tool (optional)"
  Write-Output "Download cloudflared for Public Link feature? (y/N)"
  Write-Output "This will download a small helper tool into:"
  Write-Output "  $binDir"
  Write-Output "It can be removed anytime."
  $ans = Read-Host "Download cloudflared for Public Link feature? (y/N)"
  if ($ans -notmatch '^(y|Y|yes|YES)$') { return }

  New-Item -ItemType Directory -Force -Path $binDir | Out-Null

  $versionLine = (Get-Content $apiEnv | Where-Object { $_ -match "^CLOUDFLARED_VERSION=" } | Select-Object -First 1)
  $version = ($versionLine -replace "^CLOUDFLARED_VERSION=", "" | Select-Object -First 1)
  if ($null -eq $version) {
    $version = "latest"
  } else {
    $version = $version.ToString().Trim('"')
    if (-not $version) { $version = "latest" }
  }
  if ($version -eq "latest") {
    $base = "https://github.com/cloudflare/cloudflared/releases/latest/download"
  } else {
    $base = "https://github.com/cloudflare/cloudflared/releases/download/$version"
  }

  $archTag = ""
  $procArch = String($env:PROCESSOR_ARCHITECTURE).ToUpperInvariant()
  if ($procArch -eq "AMD64" -or $procArch -eq "X86_64") { $archTag = "amd64" }
  if ($procArch -eq "ARM64") { $archTag = "arm64" }
  if (-not $archTag -and (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) {
    try {
      $osArch = String((Get-CimInstance Win32_OperatingSystem).OSArchitecture).ToUpperInvariant()
      if ($osArch -match "ARM64") { $archTag = "arm64" }
      elseif ($osArch -match "64") { $archTag = "amd64" }
    } catch {}
  }
  if (-not $archTag) {
    Write-Output "[install] WARNING: Unsupported platform/arch for cloudflared download."
    Write-Output "[install] Public Link disabled until cloudflared is installed."
    Write-Output "[install] Install manually: winget install --id Cloudflare.cloudflared -e"
    return
  }
  $url = "$base/cloudflared-windows-$archTag.exe"

  Write-Output "[install] Downloading helper tool..."
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing | Out-Null
  } catch {
    Write-Output "[install] WARNING: cloudflared download failed."
    Write-Output "[install] Public Link disabled until cloudflared is installed."
    Write-Output "[install] Install manually: winget install --id Cloudflare.cloudflared -e"
    return
  }

  $stateFile = Join-Path $rootVal "state.json"
  $consent = @{
    publicSharingConsent = @{
      granted = $true
      dontAskAgain = $true
      grantedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    publicSharingAutoStart = $true
  }
  if (Test-Path $stateFile) {
    try {
      $existing = Get-Content $stateFile | ConvertFrom-Json
      $existing.publicSharingConsent = $consent.publicSharingConsent
      $existing.publicSharingAutoStart = $true
      $existing | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
    } catch {
      $consent | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
    }
  } else {
    $consent | ConvertTo-Json -Depth 10 | Set-Content -Path $stateFile
  }

  Write-Output "[install] cloudflared installed: $dest"
}

Prompt-InstallCloudflared

$envText = Get-Content $apiEnv -ErrorAction SilentlyContinue
$rootLine = ($envText | Where-Object { $_ -match "^CONTENTBOX_ROOT=" } | Select-Object -First 1)
$rootVal = Join-Path $HOME "contentbox-data"
if ($rootLine) {
  $rootVal = $rootLine -replace "^CONTENTBOX_ROOT=", ""
  $rootVal = $rootVal.Trim('"')
  if (-not (Test-Path $rootVal)) { New-Item -ItemType Directory -Force -Path $rootVal | Out-Null }
}
$cloudflaredLocal = Join-Path (Join-Path $rootVal ".bin") "cloudflared.exe"
if ((Get-Command cloudflared -ErrorAction SilentlyContinue) -or (Test-Path $cloudflaredLocal)) {
  Write-Output "[install] cloudflared installed: $cloudflaredLocal"
} else {
  Write-Output "[install] Public Link disabled until cloudflared is installed."
  Write-Output "[install] Install manually: winget install --id Cloudflare.cloudflared -e"
}

Push-Location $apiDir
Write-Output "[install] Installing API dependencies"
npm install
$schemaPath = "prisma/schema.sqlite.prisma"
if ($dbMode -eq "advanced") { $schemaPath = "prisma/schema.prisma" }
npx prisma validate --schema $schemaPath
Write-Output "[install] Generating Prisma client"
npx prisma generate --schema $schemaPath
if (-not (Test-Path (Join-Path $apiDir "node_modules/.prisma/client"))) {
  Fail "Prisma client generation failed. Run: npx prisma generate"
}
Write-Output "[install] Syncing database schema"
if ($dbMode -eq "basic") {
  npx prisma db push --schema $schemaPath
} else {
  if ((Test-Path "prisma/migrations") -and ((Get-ChildItem "prisma/migrations" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)) {
    npx prisma migrate deploy --schema $schemaPath
  } else {
    npx prisma db push --schema $schemaPath
  }
}
Pop-Location

Push-Location $dashDir
Write-Output "[install] Installing dashboard dependencies"
npm install
Pop-Location

Write-Output "[install] Next steps:"
Write-Output "  Terminal 1: cd apps/api && npm run dev"
Write-Output "  Terminal 2: cd apps/dashboard && npm run dev"
Write-Output "  API: http://127.0.0.1:4000"
Write-Output "  Dashboard: http://127.0.0.1:5173"
Write-Output "  Public server: http://127.0.0.1:4010 (PUBLIC_PORT)"
Write-Output "  Quickstart: docs/QUICKSTART.md"
