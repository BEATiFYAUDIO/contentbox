Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$pidFile = Join-Path $dataRoot "state\certifyd-core.pid"

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4000/health" -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

$pid = "none"
$alive = $false
if (Test-Path $pidFile) {
  $rawPid = (Get-Content $pidFile -Raw).Trim()
  $parsed = 0
  if ([int]::TryParse($rawPid, [ref]$parsed) -and $parsed -gt 0) {
    $pid = [string]$parsed
    $alive = $null -ne (Get-Process -Id $parsed -ErrorAction SilentlyContinue)
  }
}

Write-Host "Certifyd Core"
Write-Host "  Data:   $dataRoot"
Write-Host "  PID:    $pid"
Write-Host "  Alive:  $alive"
Write-Host "  Health: $(Test-Health)"
Write-Host "  URL:    http://127.0.0.1:4000"
Read-Host "Press Enter to close"
