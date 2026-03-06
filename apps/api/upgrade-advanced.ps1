Param()

$ErrorActionPreference = "Stop"

function Say($msg) {
  Write-Output "[upgrade-advanced] $msg"
}

function Read-EnvValue([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return $null }
  $line = Get-Content $path | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -replace "^$key=", "").Trim().Trim('"'))
}

function Ensure-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $name"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$apiDir = Join-Path $root "apps/api"
$apiEnv = Join-Path $apiDir ".env"

Ensure-Command "node"
Ensure-Command "npm"

Say "Running advanced bootstrap checks (safe to rerun)."

$contentboxRoot = Read-EnvValue $apiEnv "CONTENTBOX_ROOT"
if (-not $contentboxRoot) {
  $contentboxRoot = Join-Path $HOME "contentbox-data"
}
$cloudflaredLocal = Join-Path (Join-Path $contentboxRoot ".bin") "cloudflared.exe"

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  Say "cloudflared is available in PATH."
} elseif (Test-Path $cloudflaredLocal) {
  Say "cloudflared is available at $cloudflaredLocal."
} else {
  Say "cloudflared missing. Public Link stays disabled until installed."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "Attempting install with winget..."
    try {
      winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements | Out-Null
      Say "cloudflared install command completed."
    } catch {
      Say "cloudflared install failed. Install manually: winget install --id Cloudflare.cloudflared -e"
    }
  } else {
    Say "Install manually: winget install --id Cloudflare.cloudflared -e"
  }
}

Push-Location $apiDir
Say "Installing API dependencies..."
npm install
Say "Generating Prisma client for advanced schema..."
npx prisma generate --schema prisma/schema.prisma
if (-not (Test-Path (Join-Path $apiDir "node_modules/.prisma/client"))) {
  throw "Prisma client generation failed. Run: npx prisma generate --schema prisma/schema.prisma"
}
Say "Advanced schema bootstrap..."
if ((Test-Path "prisma/migrations") -and ((Get-ChildItem "prisma/migrations" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)) {
  npx prisma migrate deploy --schema prisma/schema.prisma
} else {
  npx prisma db push --schema prisma/schema.prisma
}
Pop-Location

$lndRestUrl = Read-EnvValue $apiEnv "LND_REST_URL"
if (-not $lndRestUrl) {
  $lndRestUrl = "https://127.0.0.1:8080"
}

try {
  $uri = [Uri]$lndRestUrl
  $tcp = New-Object System.Net.Sockets.TcpClient
  $iar = $tcp.BeginConnect($uri.Host, $uri.Port, $null, $null)
  if (-not $iar.AsyncWaitHandle.WaitOne(2000, $false)) {
    $tcp.Close()
    throw "timeout"
  }
  $tcp.EndConnect($iar) | Out-Null
  $tcp.Close()
  Say "LND REST endpoint reachable at $($uri.Host):$($uri.Port)."
} catch {
  Say "LND REST endpoint not reachable ($lndRestUrl). Configure in UI: Profile -> Node Mode -> Advanced, then Finance."
}

Say "Done. Next: switch Node Mode to Advanced in Profile, then complete Lightning setup in Finance."
