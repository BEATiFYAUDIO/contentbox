Param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [int]$Port = 4000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Bundled Core runtime not found." }
if ($Port -lt 1 -or $Port -gt 65535) { throw "Invalid Core port." }

$ruleName = "Certifyd Core LAN"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description "Allow authenticated Certifyd Core dashboard access on private networks." `
  -Direction Inbound `
  -Action Allow `
  -Profile Private `
  -Protocol TCP `
  -LocalPort $Port `
  -Program ([System.IO.Path]::GetFullPath($NodePath)) | Out-Null
