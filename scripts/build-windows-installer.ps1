Param(
  [string]$Version = "0.1.0-beta",
  [string]$NodeVersion = "20.19.0",
  [string]$InnoSetupCompiler = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($message) {
  Write-Error "[windows-package] $message"
  exit 1
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Resolve-Iscc($explicit) {
  if ($explicit -and (Test-Path $explicit)) { return $explicit }
  $cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  Fail "Inno Setup 6 compiler not found. Install Inno Setup or pass -InnoSetupCompiler."
}

function Resolve-Magick {
  $cmd = Get-Command magick.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:ProgramFiles\ImageMagick-7.1.2-Q16-HDRI\magick.exe",
    "$env:ProgramFiles\ImageMagick-7.1.1-Q16-HDRI\magick.exe",
    "$env:ProgramFiles\ImageMagick-7.1.0-Q16-HDRI\magick.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  Fail "ImageMagick magick.exe not found. Install ImageMagick so the Certifyd SVG can be converted to a Windows .ico package icon."
}

function Export-EmbeddedPngFromSvg {
  param(
    [Parameter(Mandatory=$true)][string]$SvgPath,
    [Parameter(Mandatory=$true)][string]$PngPath
  )
  $svg = Get-Content -Raw -Path $SvgPath
  if ($svg -notmatch 'data:image/png;base64,([^"'']+)') {
    Fail "Certifyd package icon SVG does not contain an embedded PNG image."
  }
  [System.IO.File]::WriteAllBytes($PngPath, [System.Convert]::FromBase64String($Matches[1]))
}

if ($env:OS -notmatch "Windows") {
  Fail "Build the Windows x64 installer on Windows so native dependencies and Prisma engines are Windows-compatible."
}
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "X86_64")) {
  Fail "This packaging pass targets Windows x64 only."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $repoRoot ".dist\windows-x64"
$stageRoot = Join-Path $distRoot "stage"
$cacheDir = Join-Path $distRoot "cache"
$installerDir = Join-Path $distRoot "installer"
$appStage = Join-Path $stageRoot "app"
$runtimeStage = Join-Path $stageRoot "runtime"
$assetsStage = Join-Path $stageRoot "assets"
$nodeDir = Join-Path $runtimeStage "node"
$nodeZip = Join-Path $cacheDir "node-v$NodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$iscc = Resolve-Iscc $InnoSetupCompiler
$magick = Resolve-Magick

Write-Host "[windows-package] Repo: $repoRoot"
Write-Host "[windows-package] Node: $NodeVersion"
Write-Host "[windows-package] Inno Setup: $iscc"
Write-Host "[windows-package] ImageMagick: $magick"

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $cacheDir, $installerDir, $appStage, $runtimeStage, $assetsStage | Out-Null

if (-not (Test-Path $nodeZip)) {
  Write-Host "[windows-package] Downloading Node runtime: $nodeUrl"
  Invoke-WebRequest -UseBasicParsing -Uri $nodeUrl -OutFile $nodeZip
}

$nodeExtract = Join-Path $runtimeStage "node-extract"
Expand-Archive -Path $nodeZip -DestinationPath $nodeExtract -Force
$nodeSource = Join-Path $nodeExtract "node-v$NodeVersion-win-x64"
if (-not (Test-Path (Join-Path $nodeSource "node.exe"))) {
  Fail "Downloaded Node archive did not contain node.exe."
}
Move-Item $nodeSource $nodeDir
Remove-Item $nodeExtract -Recurse -Force

$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd = Join-Path $nodeDir "npm.cmd"

Write-Host "[windows-package] Bundled Node:"
Invoke-Checked $nodeExe "-v"
Invoke-Checked $npmCmd "-v"

New-Item -ItemType Directory -Force -Path `
  (Join-Path $appStage "apps\api"), `
  (Join-Path $appStage "apps\dashboard"), `
  (Join-Path $appStage "launcher") | Out-Null

$apiSource = Join-Path $repoRoot "apps\api"
$apiTarget = Join-Path $appStage "apps\api"
foreach ($item in @("package.json", "package-lock.json", "tsconfig.json", "src", "prisma", "scripts", "upgrade-advanced.ps1")) {
  $source = Join-Path $apiSource $item
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $apiTarget $item) -Recurse -Force
  }
}

$dashboardSource = Join-Path $repoRoot "apps\dashboard"
$dashboardTarget = Join-Path $appStage "apps\dashboard"
foreach ($item in @("package.json", "package-lock.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "vite.config.ts", "index.html", "src", "public", "postcss.config.js", "tailwind.config.js")) {
  $source = Join-Path $dashboardSource $item
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $dashboardTarget $item) -Recurse -Force
  }
}

Copy-Item (Join-Path $repoRoot "packaging\windows\CertifydCore.Launcher.ps1") (Join-Path $appStage "launcher\CertifydCore.Launcher.ps1") -Force
Copy-Item (Join-Path $repoRoot "packaging\windows\CertifydCore.Stop.ps1") (Join-Path $appStage "launcher\CertifydCore.Stop.ps1") -Force
Copy-Item (Join-Path $repoRoot "packaging\windows\CertifydCore.Status.ps1") (Join-Path $appStage "launcher\CertifydCore.Status.ps1") -Force

$iconSource = Join-Path $repoRoot "apps\dashboard\src\assets\certifyd_icon_logo_only.svg"
$iconIco = Join-Path $assetsStage "certifyd-core.ico"
$iconPng = Join-Path $assetsStage "certifyd-core.png"
$iconSvg = Join-Path $assetsStage "certifyd-core.svg"
if (-not (Test-Path $iconSource)) {
  Fail "Missing Certifyd package icon source: $iconSource"
}
Copy-Item $iconSource $iconSvg -Force
Export-EmbeddedPngFromSvg $iconSource $iconPng
Invoke-Checked $magick $iconPng "-resize" "256x256" "-define" "icon:auto-resize=256,128,64,48,32,16" $iconIco

Write-Host "[windows-package] Installing API dependencies into staging..."
Invoke-Checked $npmCmd "--prefix" $apiTarget "ci"

Write-Host "[windows-package] Generating Windows Prisma client..."
$apiSchema = Join-Path $apiTarget "prisma\schema.prisma"
$packageDb = Join-Path $apiTarget "contentbox-package-build.db"
$env:DATABASE_URL = "file:$(($packageDb -replace "\\", "/"))"
Invoke-Checked $npmCmd "--prefix" $apiTarget "exec" "--" "prisma" "validate" "--schema" $apiSchema
Invoke-Checked $npmCmd "--prefix" $apiTarget "exec" "--" "prisma" "generate" "--schema" $apiSchema
Remove-Item $packageDb -Force -ErrorAction SilentlyContinue

Write-Host "[windows-package] Installing dashboard dependencies into staging..."
Invoke-Checked $npmCmd "--prefix" $dashboardTarget "ci"
Write-Host "[windows-package] Building dashboard..."
Invoke-Checked $npmCmd "--prefix" $dashboardTarget "run" "build"
Remove-Item (Join-Path $dashboardTarget "node_modules") -Recurse -Force

$checks = @(
  (Join-Path $nodeDir "node.exe"),
  (Join-Path $apiTarget "node_modules\tsx"),
  (Join-Path $apiTarget "node_modules\prisma\build\index.js"),
  (Join-Path $apiTarget "node_modules\.prisma\client"),
  (Join-Path $apiTarget "prisma\schema.prisma"),
  (Join-Path $dashboardTarget "dist\index.html"),
  (Join-Path $appStage "launcher\CertifydCore.Launcher.ps1"),
  (Join-Path $assetsStage "certifyd-core.ico")
)
foreach ($check in $checks) {
  if (-not (Test-Path $check)) {
    Fail "Missing expected packaged artifact: $check"
  }
}

$iss = Join-Path $repoRoot "packaging\windows\CertifydCore.iss"
Write-Host "[windows-package] Building installer..."
Invoke-Checked $iscc `
  "/DSourceDir=$stageRoot" `
  "/DOutputDir=$installerDir" `
  "/DAppVersion=$Version" `
  $iss

Write-Host "[windows-package] Done."
Get-ChildItem $installerDir -Filter "*.exe" | ForEach-Object {
  Write-Host "[windows-package] Installer: $($_.FullName)"
}
