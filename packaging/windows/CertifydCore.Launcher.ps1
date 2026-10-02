Param(
  [switch]$Lan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($message) {
  Write-Error "[Certifyd Core] $message"
  exit 1
}

function Resolve-AppDir {
  $launcherDir = Split-Path -Parent $PSCommandPath
  return Split-Path -Parent $launcherDir
}

function Ensure-Dir($path) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function New-SecretHex {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Test-PrivateIpv4($ip) {
  return ($ip -match '^10\.' -or $ip -match '^192\.168\.' -or $ip -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.')
}

function Test-VirtualInterface($name) {
  if (-not $name) { return $false }
  return ($name -match '^(vEthernet|Docker|Loopback|Tailscale|ZeroTier|WireGuard|Hyper-V|VirtualBox|VMware|TAP|VPN)')
}

function Normalize-HostList($values) {
  $seen = @{}
  $result = @()
  foreach ($value in $values) {
    if (-not $value) { continue }
    foreach ($part in ([string]$value -split '[,\s]+')) {
      $host = $part.Trim().Trim('"').Trim("'")
      if (-not $host -or $seen.ContainsKey($host)) { continue }
      $seen[$host] = $true
      $result += $host
    }
  }
  return @($result)
}

function Merge-HostLists($existing, $detected) {
  $combined = @()
  $combined += $existing
  $combined += $detected
  return @(Normalize-HostList $combined)
}

function Get-PrimaryLanHost {
  if (Get-Command Get-NetRoute -ErrorAction SilentlyContinue) {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
      Sort-Object RouteMetric, InterfaceMetric |
      Select-Object -First 1
    if ($route -and (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
      $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
        Where-Object {
          (Test-PrivateIpv4 $_.IPAddress) -and
          $_.IPAddress -notmatch '^169\.254\.' -and
          -not (Test-VirtualInterface $_.InterfaceAlias)
        } |
        Select-Object -ExpandProperty IPAddress -First 1
      if ($ip) { return $ip }
    }
  }
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-PrivateIpv4 $_.IPAddress) -and
        $_.IPAddress -notmatch '^169\.254\.' -and
        -not (Test-VirtualInterface $_.InterfaceAlias)
      } |
      Select-Object -ExpandProperty IPAddress -First 1
    if ($ip) { return $ip }
  }
  return ""
}

function Get-LanHosts {
  $hosts = @()
  $primary = Get-PrimaryLanHost
  if ($primary) { $hosts += $primary }
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $hosts += Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-PrivateIpv4 $_.IPAddress) -and
        $_.IPAddress -notmatch '^127\.' -and
        $_.IPAddress -notmatch '^169\.254\.' -and
        -not (Test-VirtualInterface $_.InterfaceAlias)
      } |
      Select-Object -ExpandProperty IPAddress
  }
  return @(Normalize-HostList $hosts)
}

function Normalize-FileUrlPath($path) {
  return ($path -replace "\\", "/")
}

function Test-UninitializedValue($value) {
  if ($null -eq $value) { return $true }
  $text = ([string]$value).Trim().Trim('"').Trim("'")
  return (-not $text -or $text -match "<user>")
}

function Test-UninitializedDatabaseUrl($value) {
  if (Test-UninitializedValue $value) { return $true }
  $text = ([string]$value).Trim().Trim('"').Trim("'")
  return ($text -eq "file:./contentbox.db")
}

function Read-EnvFile($path) {
  $values = @{}
  if (-not (Test-Path $path)) { return $values }
  foreach ($line in Get-Content $path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or ($trimmed -notmatch "^[A-Za-z_][A-Za-z0-9_]*=")) { continue }
    $parts = $trimmed -split "=", 2
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$parts[0]] = $value
  }
  return $values
}

function Write-EnvFile($path, $values) {
  $orderedKeys = @(
    "DB_MODE",
    "CONTENTBOX_ROOT",
    "DATABASE_URL",
    "JWT_SECRET",
    "CONTENTBOX_PRIVATE_BIND",
    "CONTENTBOX_PRIVATE_ALLOWED_HOSTS",
    "CONTENTBOX_BIND",
    "PUBLIC_MODE",
    "PORT",
    "APP_BASE_URL"
  )
  $lines = @(
    "# Certifyd Core local runtime configuration",
    "# This file is user data. Installer updates must not overwrite it."
  )
  foreach ($key in $orderedKeys) {
    if ($values.ContainsKey($key)) {
      $value = [string]$values[$key]
      if ($value -match "\s" -or $value -match "[:\\/]") {
        $lines += "$key=`"$value`""
      } else {
        $lines += "$key=$value"
      }
    }
  }
  foreach ($key in ($values.Keys | Sort-Object)) {
    if ($orderedKeys -contains $key) { continue }
    $lines += "$key=$($values[$key])"
  }
  Set-Content -Path $path -Value $lines -Encoding UTF8
}

function Apply-Env($values) {
  foreach ($key in $values.Keys) {
    [Environment]::SetEnvironmentVariable($key, [string]$values[$key], "Process")
  }
}

function Invoke-NodeChecked {
  param(
    [Parameter(Mandatory=$true)][string]$NodeExe,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )
  Push-Location $WorkingDirectory
  try {
    & $NodeExe @Arguments
    if ($LASTEXITCODE -ne 0) {
      Fail "node $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4000/health" -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

$appDir = Resolve-AppDir
$nodeExe = Join-Path $appDir "runtime\node\node.exe"
$apiDir = Join-Path $appDir "apps\api"
$schemaPath = Join-Path $apiDir "prisma\schema.prisma"
$prismaCli = Join-Path $apiDir "node_modules\prisma\build\index.js"
$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$configDir = Join-Path $dataRoot "config"
$stateDir = Join-Path $dataRoot "state"
$logDir = Join-Path $dataRoot "logs"
$envFile = Join-Path $configDir "api.env"
$pidFile = Join-Path $stateDir "certifyd-core.pid"
$stdoutLog = Join-Path $logDir "certifyd-core.out.log"
$stderrLog = Join-Path $logDir "certifyd-core.err.log"

if (-not (Test-Path $nodeExe)) { Fail "Bundled Node runtime missing: $nodeExe" }
if (-not (Test-Path $apiDir)) { Fail "API runtime missing: $apiDir" }
if (-not (Test-Path $schemaPath)) { Fail "Prisma schema missing: $schemaPath" }
if (-not (Test-Path $prismaCli)) { Fail "Bundled Prisma CLI missing: $prismaCli" }

Ensure-Dir $dataRoot
Ensure-Dir $configDir
Ensure-Dir $stateDir
Ensure-Dir $logDir

$envValues = Read-EnvFile $envFile
if (-not $envValues.ContainsKey("DB_MODE") -or (Test-UninitializedValue $envValues["DB_MODE"])) {
  $envValues["DB_MODE"] = "basic"
}
if (-not $envValues.ContainsKey("CONTENTBOX_ROOT") -or (Test-UninitializedValue $envValues["CONTENTBOX_ROOT"])) {
  $envValues["CONTENTBOX_ROOT"] = $dataRoot
}
$contentboxRoot = [string]$envValues["CONTENTBOX_ROOT"]
Ensure-Dir $contentboxRoot
$dbPath = Join-Path $contentboxRoot "contentbox.db"
if (-not $envValues.ContainsKey("DATABASE_URL") -or (Test-UninitializedDatabaseUrl $envValues["DATABASE_URL"])) {
  $envValues["DATABASE_URL"] = "file:$(Normalize-FileUrlPath $dbPath)"
}
$envValues["CONTENTBOX_PRIVATE_BIND"] = if ($envValues.ContainsKey("CONTENTBOX_PRIVATE_BIND")) { $envValues["CONTENTBOX_PRIVATE_BIND"] } else { "local" }
$envValues["CONTENTBOX_BIND"] = if ($envValues.ContainsKey("CONTENTBOX_BIND")) { $envValues["CONTENTBOX_BIND"] } else { "local" }
$envValues["PUBLIC_MODE"] = if ($envValues.ContainsKey("PUBLIC_MODE")) { $envValues["PUBLIC_MODE"] } else { "off" }
$envValues["PORT"] = if ($envValues.ContainsKey("PORT")) { $envValues["PORT"] } else { "4000" }
$envValues["APP_BASE_URL"] = if ($envValues.ContainsKey("APP_BASE_URL")) { $envValues["APP_BASE_URL"] } else { "http://127.0.0.1:4000" }
if ($Lan) {
  $lanHosts = Get-LanHosts
  $lanPrimaryHost = if ($lanHosts.Count -gt 0) { $lanHosts[0] } else { "" }
  $envValues["CONTENTBOX_PRIVATE_BIND"] = "public"
  if ($lanHosts.Count -gt 0) {
    $existingAllowedHosts = if ($envValues.ContainsKey("CONTENTBOX_PRIVATE_ALLOWED_HOSTS")) { $envValues["CONTENTBOX_PRIVATE_ALLOWED_HOSTS"] } else { "" }
    $envValues["CONTENTBOX_PRIVATE_ALLOWED_HOSTS"] = ((Merge-HostLists $existingAllowedHosts $lanHosts) -join ",")
    $envValues["APP_BASE_URL"] = "http://$lanPrimaryHost`:$($envValues["PORT"])"
  }
}
if (-not $envValues.ContainsKey("JWT_SECRET") -or -not $envValues["JWT_SECRET"] -or $envValues["JWT_SECRET"] -eq "change-me") {
  $envValues["JWT_SECRET"] = New-SecretHex
}

Write-EnvFile $envFile $envValues
Apply-Env $envValues

if (-not (Test-Path $dbPath)) {
  New-Item -ItemType File -Path $dbPath | Out-Null
}

Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "validate", "--schema", $schemaPath)
if (-not (Test-Path (Join-Path $apiDir "node_modules\.prisma\client"))) {
  Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "generate", "--schema", $schemaPath)
}
Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "db", "push", "--schema", $schemaPath)

if (Test-Health) {
  Start-Process ([string]$envValues["APP_BASE_URL"])
  exit 0
}

$existingPid = $null
if (Test-Path $pidFile) {
  $rawPid = (Get-Content $pidFile -Raw).Trim()
  if ([int]::TryParse($rawPid, [ref]$existingPid)) {
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
      Start-Process ([string]$envValues["APP_BASE_URL"])
      exit 0
    }
  }
}

$process = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList @("--import", "tsx", "src/server.ts") `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Set-Content -Path $pidFile -Value "$($process.Id)" -Encoding ASCII

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  if (Test-Health) {
    Start-Process ([string]$envValues["APP_BASE_URL"])
    exit 0
  }
  Start-Sleep -Milliseconds 750
}

Fail "Core did not become ready. Check logs in $logDir"
