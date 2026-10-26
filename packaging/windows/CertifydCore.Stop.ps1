Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$pidFile = Join-Path $dataRoot "state\certifyd-core.pid"
$launcherDir = Split-Path -Parent $PSCommandPath
$appDir = Split-Path -Parent $launcherDir
$nodeExe = Join-Path $appDir "runtime\node\node.exe"

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

if (-not (Test-Path $pidFile)) {
  Write-Host "[Certifyd Core] No runtime pid file found."
  exit 0
}

$rawPid = (Get-Content $pidFile -Raw).Trim()
$processId = 0
if (-not [int]::TryParse($rawPid, [ref]$processId) -or $processId -le 0) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[Certifyd Core] Removed invalid pid file."
  exit 0
}

$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($null -eq $process) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[Certifyd Core] Runtime is not running."
  exit 0
}

if (-not (Test-CoreProcess $processId)) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[Certifyd Core] Removed stale pid file; the process is not this Certifyd Core runtime."
  exit 0
}

& taskkill.exe /PID $processId /T /F | Out-Null
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "[Certifyd Core] Stopped."
