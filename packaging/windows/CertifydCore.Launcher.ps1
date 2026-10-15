Param(
  [switch]$Lan,
  [switch]$FirstRunQuick
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:LauncherLogDir = ""
$script:LauncherMutex = $null
$script:LauncherLockAcquired = $false
$script:SplashWindow = $null
$script:SplashStatus = $null
$script:SplashProgress = $null
$script:SplashActions = $null
$script:SplashRetry = $null
$script:SplashLogs = $null
$script:HealthUrl = "http://127.0.0.1:4000/health"

function Invoke-SplashEvents {
  if ($null -eq $script:SplashWindow) { return }
  try {
    $script:SplashWindow.Dispatcher.Invoke(
      [Action]{},
      [System.Windows.Threading.DispatcherPriority]::Background
    )
  } catch {}
}

function Start-LauncherSplash($appDir) {
  if ($env:CI -eq "true" -or $env:CERTIFYD_LAUNCHER_NO_UI -eq "1" -or $env:CERTIFYD_NO_BROWSER -eq "1") { return }
  try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $window = New-Object System.Windows.Window
    $window.Title = "Certifyd Core"
    $window.Width = 420
    $window.Height = 300
    $window.ResizeMode = "NoResize"
    $window.WindowStartupLocation = "CenterScreen"
    $window.Background = [System.Windows.Media.Brushes]::Transparent
    $window.WindowStyle = "None"
    $window.AllowsTransparency = $true
    $window.Topmost = $true

    $border = New-Object System.Windows.Controls.Border
    $border.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(8, 24, 32))
    $border.BorderBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(39, 77, 98))
    $border.BorderThickness = 1
    $border.CornerRadius = 18
    $border.Padding = 28

    $stack = New-Object System.Windows.Controls.StackPanel
    $stack.HorizontalAlignment = "Stretch"

    $logo = New-Object System.Windows.Controls.Image
    $logo.Width = 92
    $logo.Height = 92
    $logo.HorizontalAlignment = "Center"
    $logo.Margin = "0,0,0,12"
    $logoPath = Join-Path $appDir "assets\certifyd-core.png"
    if (Test-Path $logoPath) {
      $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
      $bitmap.BeginInit()
      $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bitmap.UriSource = New-Object System.Uri($logoPath)
      $bitmap.EndInit()
      $logo.Source = $bitmap
    }

    $title = New-Object System.Windows.Controls.TextBlock
    $title.Text = "Certifyd Core"
    $title.Foreground = [System.Windows.Media.Brushes]::White
    $title.FontSize = 25
    $title.FontWeight = "SemiBold"
    $title.HorizontalAlignment = "Center"

    $status = New-Object System.Windows.Controls.TextBlock
    $status.Text = "Preparing the local dashboard..."
    $status.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(192, 209, 220))
    $status.FontSize = 14
    $status.TextAlignment = "Center"
    $status.TextWrapping = "Wrap"
    $status.Margin = "0,10,0,16"

    $progress = New-Object System.Windows.Controls.ProgressBar
    $progress.IsIndeterminate = $true
    $progress.Height = 5
    $progress.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(79, 139, 255))
    $progress.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(20, 48, 63))

    $actions = New-Object System.Windows.Controls.StackPanel
    $actions.Orientation = "Horizontal"
    $actions.HorizontalAlignment = "Center"
    $actions.Margin = "0,18,0,0"
    $actions.Visibility = "Collapsed"

    $retry = New-Object System.Windows.Controls.Button
    $retry.Content = "Retry"
    $retry.MinWidth = 100
    $retry.Height = 36
    $retry.Margin = "0,0,8,0"
    $retry.Add_Click({
      $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $PSCommandPath)
      if ($Lan) { $arguments += "-Lan" }
      if ($FirstRunQuick) { $arguments += "-FirstRunQuick" }
      Start-Process -FilePath "powershell.exe" -ArgumentList $arguments
      $script:SplashWindow.Close()
    })

    $logs = New-Object System.Windows.Controls.Button
    $logs.Content = "View Logs"
    $logs.MinWidth = 100
    $logs.Height = 36
    $logs.Add_Click({
      if ($script:LauncherLogDir -and (Test-Path $script:LauncherLogDir)) {
        Start-Process explorer.exe -ArgumentList @($script:LauncherLogDir)
      }
    })

    [void]$actions.Children.Add($retry)
    [void]$actions.Children.Add($logs)
    [void]$stack.Children.Add($logo)
    [void]$stack.Children.Add($title)
    [void]$stack.Children.Add($status)
    [void]$stack.Children.Add($progress)
    [void]$stack.Children.Add($actions)
    $border.Child = $stack
    $window.Content = $border
    $script:SplashWindow = $window
    $script:SplashStatus = $status
    $script:SplashProgress = $progress
    $script:SplashActions = $actions
    $script:SplashRetry = $retry
    $script:SplashLogs = $logs
    $window.Show()
    Invoke-SplashEvents
  } catch {
    $script:SplashWindow = $null
  }
}

function Set-LauncherStatus($message) {
  [Console]::WriteLine("[Certifyd Core] $message")
  if ($null -ne $script:SplashStatus) {
    $script:SplashStatus.Text = [string]$message
    Invoke-SplashEvents
  }
}

function Close-LauncherSplash {
  if ($null -ne $script:SplashWindow) {
    try { $script:SplashWindow.Close() } catch {}
    $script:SplashWindow = $null
  }
}

function Fail($message) {
  throw "[Certifyd Core] $message"
}

function Show-LaunchFailure($message) {
  $logHint = if ($script:LauncherLogDir) { "`n`nLogs: $script:LauncherLogDir" } else { "" }
  $details = "Certifyd Core could not start.`n`n$message$logHint"
  [Console]::Error.WriteLine($details)
  if ($null -ne $script:SplashWindow) {
    $script:SplashStatus.Text = $details
    $script:SplashStatus.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255, 171, 171))
    $script:SplashProgress.Visibility = "Collapsed"
    $script:SplashActions.Visibility = "Visible"
    $script:SplashWindow.Topmost = $false
    Invoke-SplashEvents
    while ($script:SplashWindow.IsVisible) {
      Invoke-SplashEvents
      Start-Sleep -Milliseconds 100
    }
    return
  }
  if ($env:CI -eq "true" -or $env:CERTIFYD_LAUNCHER_NO_UI -eq "1") { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($details, 0, "Certifyd Core", 16)
  } catch {}
}

function Open-Dashboard($url) {
  if ($env:CERTIFYD_NO_BROWSER -eq "1") { return }
  try {
    Start-Process -FilePath ([string]$url) -ErrorAction Stop
  } catch {
    Fail "Core is running, but Windows could not open the dashboard at $url. Open that address in your browser."
  }
}

function Release-LauncherLock {
  if ($script:LauncherLockAcquired -and $null -ne $script:LauncherMutex) {
    [void]$script:LauncherMutex.ReleaseMutex()
    $script:LauncherLockAcquired = $false
  }
  if ($null -ne $script:LauncherMutex) {
    $script:LauncherMutex.Dispose()
    $script:LauncherMutex = $null
  }
}

trap {
  Release-LauncherLock
  Show-LaunchFailure $_.Exception.Message
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
      $hostName = $part.Trim().Trim('"').Trim("'")
      if (-not $hostName -or $seen.ContainsKey($hostName)) { continue }
      $seen[$hostName] = $true
      $result += $hostName
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

function Remove-LauncherHosts($existing, $launcherHosts) {
  $removed = @{}
  foreach ($hostName in (Normalize-HostList $launcherHosts)) { $removed[$hostName] = $true }
  return @(Normalize-HostList $existing | Where-Object { -not $removed.ContainsKey($_) })
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

function Resolve-SqliteDatabasePath($databaseUrl, $workingDirectory) {
  $value = ([string]$databaseUrl).Trim().Trim('"').Trim("'")
  if (-not $value.StartsWith("file:", [System.StringComparison]::OrdinalIgnoreCase)) { return "" }
  $candidate = [Uri]::UnescapeDataString($value.Substring(5)) -replace "/", "\"
  if ([System.IO.Path]::IsPathRooted($candidate)) { return [System.IO.Path]::GetFullPath($candidate) }
  return [System.IO.Path]::GetFullPath((Join-Path $workingDirectory $candidate))
}

function Backup-SqliteForUpgrade($databasePath, $dataRoot, $stateDir, $appVersion) {
  if (-not $databasePath -or -not (Test-Path $databasePath)) { return "" }
  $db = Get-Item $databasePath -ErrorAction SilentlyContinue
  if ($null -eq $db -or $db.Length -eq 0) { return "" }
  $safeVersion = ([string]$appVersion) -replace '[^A-Za-z0-9._-]', '_'
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $backupDir = Join-Path $dataRoot "backups\pre-upgrade\$stamp-$safeVersion"
  Ensure-Dir $backupDir
  foreach ($source in @($databasePath, "$databasePath-wal", "$databasePath-shm")) {
    if (Test-Path $source) { Copy-Item -LiteralPath $source -Destination $backupDir -Force }
  }
  @(
    "Certifyd Core pre-upgrade recovery point",
    "Application version: $appVersion",
    "Database path: $databasePath",
    "",
    "Keep Core stopped before restoring this database and its matching -wal/-shm files.",
    "Use View Logs or Certifyd support if preparation failed."
  ) | Set-Content -Path (Join-Path $backupDir "RECOVERY.txt") -Encoding UTF8
  Set-Content -Path (Join-Path $stateDir "last-database-backup.txt") -Value $backupDir -Encoding ASCII
  return $backupDir
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
    $response = Invoke-WebRequest -UseBasicParsing -Uri $script:HealthUrl -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Test-CoreProcess($processId, $nodeExe) {
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

function Test-AnyCoreProcess($nodeExe) {
  try {
    $expectedExe = [System.IO.Path]::GetFullPath($nodeExe)
    foreach ($record in (Get-CimInstance Win32_Process -ErrorAction Stop)) {
      if (-not $record.ExecutablePath) { continue }
      $actualExe = [System.IO.Path]::GetFullPath([string]$record.ExecutablePath)
      if ($actualExe -ieq $expectedExe -and [string]$record.CommandLine -match 'src[\\/]server\.ts') { return $true }
    }
  } catch {
    Fail "Could not verify that the Core database is idle before applying the update."
  }
  return $false
}

function Wait-ForCoreHealth($seconds, $process = $null) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Health) { return $true }
    if ($null -ne $process) {
      $process.Refresh()
      if ($process.HasExited) { return $false }
    }
    Start-Sleep -Milliseconds 750
  }
  return $false
}

$appDir = Resolve-AppDir
Start-LauncherSplash $appDir
Set-LauncherStatus "Checking the local runtime..."
$nodeExe = Join-Path $appDir "runtime\node\node.exe"
$apiDir = Join-Path $appDir "apps\api"
$schemaPath = Join-Path $apiDir "prisma\schema.prisma"
$prismaCli = Join-Path $apiDir "node_modules\prisma\build\index.js"
$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$configDir = Join-Path $dataRoot "config"
$stateDir = Join-Path $dataRoot "state"
$logDir = Join-Path $dataRoot "logs"
$script:LauncherLogDir = $logDir
$envFile = Join-Path $configDir "api.env"
$pidFile = Join-Path $stateDir "certifyd-core.pid"
$stdoutLog = Join-Path $logDir "certifyd-core.out.log"
$stderrLog = Join-Path $logDir "certifyd-core.err.log"
$stateFile = Join-Path $dataRoot "state.json"
$newInstallAtLaunch = -not (Test-Path $envFile) -and -not (Test-Path (Join-Path $dataRoot "contentbox.db")) -and -not (Test-Path $stateFile)

if (-not (Test-Path $nodeExe)) { Fail "Bundled Node runtime missing: $nodeExe" }
if (-not (Test-Path $apiDir)) { Fail "API runtime missing: $apiDir" }
if (-not (Test-Path $schemaPath)) { Fail "Prisma schema missing: $schemaPath" }
if (-not (Test-Path $prismaCli)) { Fail "Bundled Prisma CLI missing: $prismaCli" }

Ensure-Dir $dataRoot
Ensure-Dir $configDir
Ensure-Dir $stateDir
Ensure-Dir $logDir

$script:LauncherMutex = [System.Threading.Mutex]::new($false, "Local\CertifydCoreLauncher")
try {
  $script:LauncherLockAcquired = $script:LauncherMutex.WaitOne([TimeSpan]::FromSeconds(120))
} catch [System.Threading.AbandonedMutexException] {
  # Windows transferred the abandoned launcher lock to this process.
  $script:LauncherLockAcquired = $true
}
if (-not $script:LauncherLockAcquired) { Fail "Another launcher operation did not finish within two minutes." }

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
$lanOptInFile = Join-Path $stateDir "lan-enabled"
if ($envValues["CONTENTBOX_PRIVATE_BIND"] -eq "public" -or (Test-Path $lanOptInFile)) { $Lan = $true }
if ($Lan) {
  Set-Content -Path $lanOptInFile -Value "enabled" -Encoding ASCII
  $lanHosts = @(Get-LanHosts)
  $lanPrimaryHost = if ($lanHosts.Count -gt 0) { $lanHosts[0] } else { "" }
  $launcherHostsFile = Join-Path $stateDir "launcher-lan-hosts.txt"
  $previousLauncherHosts = if (Test-Path $launcherHostsFile) { Get-Content $launcherHostsFile } else { @() }
  $existingAllowedHosts = if ($envValues.ContainsKey("CONTENTBOX_PRIVATE_ALLOWED_HOSTS")) { $envValues["CONTENTBOX_PRIVATE_ALLOWED_HOSTS"] } else { "" }
  $preservedHosts = Remove-LauncherHosts $existingAllowedHosts $previousLauncherHosts
  $envValues["CONTENTBOX_PRIVATE_BIND"] = "public"
  if ($lanHosts.Count -gt 0) {
    $envValues["CONTENTBOX_PRIVATE_ALLOWED_HOSTS"] = ((Merge-HostLists $preservedHosts $lanHosts) -join ",")
    $envValues["APP_BASE_URL"] = "http://$lanPrimaryHost`:$($envValues["PORT"])"
    Set-Content -Path $launcherHostsFile -Value ($lanHosts -join ",") -Encoding ASCII
  } else {
    $envValues["CONTENTBOX_PRIVATE_BIND"] = "local"
    $envValues["CONTENTBOX_PRIVATE_ALLOWED_HOSTS"] = ($preservedHosts -join ",")
    $envValues["APP_BASE_URL"] = "http://127.0.0.1:$($envValues["PORT"])"
  }
}
if ($FirstRunQuick -and $newInstallAtLaunch) {
  $envValues["PUBLIC_MODE"] = "quick"
}
if (-not $envValues.ContainsKey("JWT_SECRET") -or -not $envValues["JWT_SECRET"] -or $envValues["JWT_SECRET"] -eq "change-me") {
  $envValues["JWT_SECRET"] = New-SecretHex
}

Write-EnvFile $envFile $envValues
Apply-Env $envValues
if ($FirstRunQuick -and $newInstallAtLaunch -and -not (Test-Path $stateFile)) {
  $initialState = @{
    publicSharingConsent = @{ granted = $true; dontAskAgain = $true; grantedAt = [DateTime]::UtcNow.ToString("o") }
    publicSharingAutoStart = $true
  }
  $initialState | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
}
$appVersionFile = Join-Path $appDir "app-version.txt"
$appVersion = if (Test-Path $appVersionFile) { (Get-Content $appVersionFile -Raw).Trim() } else { "development" }
$databasePreparedMarker = Join-Path $stateDir "database-prepared-version.txt"
$preparedVersion = if (Test-Path $databasePreparedMarker) { (Get-Content $databasePreparedMarker -Raw).Trim() } else { "" }
$configuredDbPath = Resolve-SqliteDatabasePath $envValues["DATABASE_URL"] $apiDir
$script:HealthUrl = "http://127.0.0.1:$($envValues["PORT"])/health"

if (Test-Health) {
  Set-LauncherStatus "Core is already running. Opening the dashboard..."
  Open-Dashboard $envValues["APP_BASE_URL"]
  Close-LauncherSplash
  Release-LauncherLock
  exit 0
}

$existingPid = 0
if (Test-Path $pidFile) {
  $rawPid = (Get-Content $pidFile -Raw).Trim()
  if ([int]::TryParse($rawPid, [ref]$existingPid) -and $existingPid -gt 0) {
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($null -ne $existing -and (Test-CoreProcess $existingPid $nodeExe)) {
      Set-LauncherStatus "Waiting for the existing Core process..."
      if (Wait-ForCoreHealth 45 $existing) {
        Set-LauncherStatus "Core is ready. Opening the dashboard..."
        Open-Dashboard $envValues["APP_BASE_URL"]
        Close-LauncherSplash
        Release-LauncherLock
        exit 0
      }
      Fail "The Core process is running but did not become healthy. Use Stop Certifyd Core, then try again."
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($preparedVersion -ne $appVersion -or ($configuredDbPath -and -not (Test-Path $configuredDbPath))) {
  if (Test-AnyCoreProcess $nodeExe) { Fail "A Certifyd Core process is still using the database. Stop it before applying this update." }
  $backupDir = Backup-SqliteForUpgrade $configuredDbPath $contentboxRoot $stateDir $appVersion
  if ($backupDir) { Set-LauncherStatus "Backed up local data before the update. Validating the database..." }
  if ($configuredDbPath -and -not (Test-Path $configuredDbPath)) {
    Ensure-Dir (Split-Path -Parent $configuredDbPath)
    New-Item -ItemType File -Path $configuredDbPath | Out-Null
  }
  try {
    Set-LauncherStatus "Validating local data..."
    Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "validate", "--schema", $schemaPath)
    if (-not (Test-Path (Join-Path $apiDir "node_modules\.prisma\client"))) {
      Set-LauncherStatus "Preparing the local database client..."
      Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "generate", "--schema", $schemaPath)
    }
    Set-LauncherStatus "Applying local database updates..."
    Invoke-NodeChecked $nodeExe $apiDir @($prismaCli, "db", "push", "--schema", $schemaPath, "--skip-generate")
  } catch {
    $recoveryHint = if ($backupDir) { $backupDir } else { "No pre-update database existed." }
    throw "Local database preparation failed. Core was not started. Recovery point: $recoveryHint $($_.Exception.Message)"
  }
  Set-Content -Path "$databasePreparedMarker.tmp" -Value $appVersion -Encoding ASCII
  Move-Item -Path "$databasePreparedMarker.tmp" -Destination $databasePreparedMarker -Force
}

# A separately started healthy Core wins the race without spawning a duplicate.
if (Test-Health) {
  Set-LauncherStatus "Core became ready while preparing. Opening the dashboard..."
  Open-Dashboard $envValues["APP_BASE_URL"]
  Close-LauncherSplash
  Release-LauncherLock
  exit 0
}

Set-LauncherStatus "Starting the Certifyd Core service..."
$process = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList @("--import", "tsx", "src/server.ts") `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Set-Content -Path $pidFile -Value "$($process.Id)" -Encoding ASCII

Set-LauncherStatus "Waiting for the dashboard to become ready..."
if (Wait-ForCoreHealth 45 $process) {
  Set-LauncherStatus "Core is ready. Opening the dashboard..."
  Open-Dashboard $envValues["APP_BASE_URL"]
  Close-LauncherSplash
  Release-LauncherLock
  exit 0
}

if ($process.HasExited) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Fail "Core exited before it became ready. Check the launcher logs for the startup error."
}
Fail "Core did not become ready. Use View Logs from the Certifyd Core tray menu for details."
