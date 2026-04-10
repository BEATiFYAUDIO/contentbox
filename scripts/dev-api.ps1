Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $root "apps\api"
$lockFile = Join-Path $HOME "contentbox-data\state\api-runtime.lock.json"

if (Test-Path $lockFile) {
  try {
    $raw = Get-Content $lockFile -Raw
    $lock = $raw | ConvertFrom-Json
    $pid = [int]($lock.pid)
    if ($pid -gt 0) {
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      if ($null -ne $proc) {
        Write-Host "[dev-api] API appears to already be running (pid $pid)."
        Write-Host "[dev-api] Reusing existing runtime; not starting another watcher."
        exit 0
      }
    }
  } catch {
    # ignore malformed lock
  }
}

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4000/health" -TimeoutSec 2
  if ($health.StatusCode -ge 200 -and $health.StatusCode -lt 300) {
    Write-Host "[dev-api] API health endpoint already responding on :4000."
    Write-Host "[dev-api] Reusing existing runtime; not starting another watcher."
    exit 0
  }
} catch {
  # not running, continue
}

Set-Location $apiDir
npm run dev
