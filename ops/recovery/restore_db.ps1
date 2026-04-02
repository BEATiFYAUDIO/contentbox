Param(
  [Parameter(Mandatory = $false)]
  [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envFile = Join-Path $root "apps\api\.env"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $_ -split '=', 2
    if ($parts.Count -ne 2) { return }
    $k = $parts[0].Trim()
    $v = $parts[1].Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

$dbUrl = [string]$env:DATABASE_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  throw "DATABASE_URL not set. Check apps/api/.env"
}

if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  $BackupFile = [string]$env:BACKUP_FILE
}
if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  throw "Usage: .\restore_db.ps1 -BackupFile <path-to-backup-file>"
}

if ($dbUrl -match '^postgres(ql)?:\/\/') {
  throw "Postgres restore is manual here. Use pg_restore --clean --if-exists --no-owner --dbname `"$env:DATABASE_URL`" `"$BackupFile`""
}

if ($dbUrl -notmatch '^file:') {
  throw "Unsupported DATABASE_URL for restore: $dbUrl"
}

$pathPart = $dbUrl -replace '^file:', ''
$pathPart = $pathPart.Split('?')[0].Split('#')[0]
if ([string]::IsNullOrWhiteSpace($pathPart)) {
  throw "Invalid SQLite DATABASE_URL path."
}

$destDb = if ([System.IO.Path]::IsPathRooted($pathPart)) {
  $pathPart
} else {
  Join-Path (Join-Path $root "apps\api") $pathPart
}

if (!(Test-Path $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

$destDir = Split-Path $destDb -Parent
if (!(Test-Path $destDir)) {
  New-Item -ItemType Directory -Path $destDir | Out-Null
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
if (Test-Path $destDb) {
  $safety = "$destDb.pre-restore-$stamp.sqlite"
  Copy-Item $destDb $safety -Force
  Write-Host "Created safety backup: $safety"
}

Copy-Item $BackupFile $destDb -Force
Write-Host "Restored SQLite database from: $BackupFile"
Write-Host "Destination: $destDb"
Write-Host "Next: restart API/dashboard processes."
