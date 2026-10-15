Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$launcherDir = Split-Path -Parent $PSCommandPath
$appDir = Split-Path -Parent $launcherDir
$launcher = Join-Path $launcherDir "CertifydCore.Launcher.ps1"
$stopScript = Join-Path $launcherDir "CertifydCore.Stop.ps1"
$firewallScript = Join-Path $launcherDir "CertifydCore.Firewall.ps1"
$nodeExe = Join-Path $appDir "runtime\node\node.exe"
$iconPath = Join-Path $appDir "assets\certifyd-core.ico"
$dataRoot = Join-Path $env:LOCALAPPDATA "ContentBox"
$envFile = Join-Path $dataRoot "config\api.env"
$dbFile = Join-Path $dataRoot "contentbox.db"
$stateFile = Join-Path $dataRoot "state.json"
$logDir = Join-Path $dataRoot "logs"

function Read-EnvValue($key, $fallback = "") {
  if (-not (Test-Path $envFile)) { return $fallback }
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^$([Regex]::Escape($key))=(.*)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $fallback
}

function Get-DashboardUrl {
  return Read-EnvValue "APP_BASE_URL" "http://127.0.0.1:4000"
}

function Open-Dashboard {
  try { Start-Process -FilePath (Get-DashboardUrl) } catch {}
}

function Invoke-Script($path, [string[]]$extra = @(), [switch]$Wait) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$path`"") + $extra
  $options = @{ FilePath = "powershell.exe"; ArgumentList = $arguments; WindowStyle = "Hidden" }
  if ($Wait) { $options.Wait = $true }
  Start-Process @options | Out-Null
}

function Start-Core([switch]$Lan, [switch]$FirstRunQuick) {
  $extra = @()
  if ($Lan) { $extra += "-Lan" }
  if ($FirstRunQuick) { $extra += "-FirstRunQuick" }
  Invoke-Script $launcher $extra
}

function Stop-Core {
  Invoke-Script $stopScript @() -Wait
}

function Enable-LanFirewall {
  if (-not (Test-Path $firewallScript)) { return }
  $arguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$firewallScript`"",
    "-NodePath", "`"$nodeExe`"", "-Port", (Read-EnvValue "PORT" "4000")
  )
  try { Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait | Out-Null } catch {}
}

$controllerMutex = [System.Threading.Mutex]::new($false, "Local\CertifydCoreController")
$controllerLock = $false
try { $controllerLock = $controllerMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $controllerLock = $true }
if (-not $controllerLock) {
  Start-Core
  $controllerMutex.Dispose()
  exit 0
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "Certifyd Core"
$notify.Icon = New-Object System.Drawing.Icon($iconPath)
$notify.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip

function Add-MenuItem($label, $handler) {
  $item = $menu.Items.Add($label)
  $item.add_Click($handler)
  return $item
}

[void](Add-MenuItem "Open Dashboard" { Open-Dashboard })
[void](Add-MenuItem "Copy LAN Address" {
  try { [System.Windows.Forms.Clipboard]::SetText((Get-DashboardUrl)) } catch {}
})
[void](Add-MenuItem "Enable or Refresh LAN Access" {
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Allow authenticated access to Certifyd Core from devices on your trusted local network? Windows may request permission to add a private-network firewall rule.",
    "Certifyd Core LAN Access",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
    Enable-LanFirewall
    Stop-Core
    Start-Core -Lan
  }
})
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void](Add-MenuItem "Restart Core" { Stop-Core; Start-Core })
[void](Add-MenuItem "Stop Core" { Stop-Core })
[void](Add-MenuItem "View Logs" {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Start-Process explorer.exe -ArgumentList @("`"$logDir`"")
})
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void](Add-MenuItem "Quit Certifyd Core" {
  Stop-Core
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Open-Dashboard })

$isNewInstall = -not (Test-Path $envFile) -and -not (Test-Path $dbFile) -and -not (Test-Path $stateFile)
$lan = $false
$quick = $false
if ($isNewInstall) {
  $lan = [System.Windows.Forms.MessageBox]::Show(
    "Allow authenticated access to Certifyd Core from your phone and other devices on this trusted local network?",
    "Certifyd Core LAN Access",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  ) -eq [System.Windows.Forms.DialogResult]::Yes
  $quick = [System.Windows.Forms.MessageBox]::Show(
    "Create a temporary public creator link when Certifyd Core starts? This exposes only Core's public storefront routes, not the private dashboard.",
    "Certifyd Core Public Sharing",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  ) -eq [System.Windows.Forms.DialogResult]::Yes
  if ($lan) { Enable-LanFirewall }
}
Start-Core -Lan:$lan -FirstRunQuick:$quick

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $notify.Visible = $false
  $notify.Dispose()
  if ($controllerLock) { [void]$controllerMutex.ReleaseMutex() }
  $controllerMutex.Dispose()
}
