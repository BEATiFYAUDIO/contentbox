Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$pidFile = Join-Path $dataRoot "state\certifyd-core.pid"

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

& taskkill.exe /PID $processId /T /F | Out-Null
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "[Certifyd Core] Stopped."
