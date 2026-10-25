Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$pidFile = Join-Path $dataRoot "state\certifyd-core.pid"
$launcherDir = Split-Path -Parent $PSCommandPath
$appDir = Split-Path -Parent $launcherDir
$nodeExe = Join-Path $appDir "runtime\node\node.exe"
$envFile = Join-Path $dataRoot "config\api.env"
$port = "4000"
$appUrl = "http://127.0.0.1:4000"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^PORT=(.*)$') { $port = $Matches[1].Trim().Trim('"').Trim("'") }
    if ($line -match '^APP_BASE_URL=(.*)$') { $appUrl = $Matches[1].Trim().Trim('"').Trim("'") }
  }
}

function Test-CoreProcess($processId) {
  try {
    $record = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $record) { return $false }
    $actualExe = [System.IO.Path]::GetFullPath([string]$record.ExecutablePath)
    $expectedExe = [System.IO.Path]::GetFullPath($nodeExe)
    return ($actualExe -ieq $expectedExe -and [string]$record.CommandLine -match 'src[\\/]server\.ts')
  } catch {
    return $false
  }
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

$displayPid = "none"
$alive = $false
if (Test-Path $pidFile) {
  $rawPid = (Get-Content $pidFile -Raw).Trim()
  $parsed = 0
  if ([int]::TryParse($rawPid, [ref]$parsed) -and $parsed -gt 0) {
    $displayPid = [string]$parsed
    $alive = Test-CoreProcess $parsed
  }
}

Write-Host "Certifyd Core"
Write-Host "  Data:   $dataRoot"
Write-Host "  PID:    $displayPid"
Write-Host "  Alive:  $alive"
Write-Host "  Health: $(Test-Health)"
Write-Host "  URL:    $appUrl"
Read-Host "Press Enter to close"
