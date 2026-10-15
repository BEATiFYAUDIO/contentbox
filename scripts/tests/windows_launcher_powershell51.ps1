Param(
  [Parameter(Mandatory = $true)][string]$LauncherPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $LauncherPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "Launcher did not parse under Windows PowerShell 5.1: $($parseErrors[0].Message)"
}

$normalizeFunction = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Normalize-HostList"
}, $true)
if ($null -eq $normalizeFunction) {
  throw "Normalize-HostList was not found in the installed launcher."
}

Invoke-Expression $normalizeFunction.Extent.Text

function Assert-HostCount($values, [int]$expected, [string]$label) {
  $actual = @(Normalize-HostList $values)
  if ($actual.Count -ne $expected) {
    throw "$label returned $($actual.Count) LAN hosts; expected $expected."
  }
}

Assert-HostCount @() 0 "zero-address case"
Assert-HostCount @("192.168.10.25") 1 "one-address case"
Assert-HostCount @("192.168.10.25", "10.0.0.8") 2 "multiple-address case"

Write-Output "Windows PowerShell 5.1 LAN host cases=PASS"
