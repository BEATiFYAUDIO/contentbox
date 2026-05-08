$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $RootDir "apps/api"
$SchemaPath = "prisma/schema.prisma"

Write-Host "[upgrade-local-sqlite] Repo: $RootDir"
Write-Host "[upgrade-local-sqlite] API:  $ApiDir"

Push-Location $ApiDir
try {
  Write-Host "[upgrade-local-sqlite] Step 1/2: prisma generate"
  npx prisma generate --schema $SchemaPath

  Write-Host "[upgrade-local-sqlite] Step 2/2: prisma migrate deploy"
  $migrateOutput = & npx prisma migrate deploy --schema $SchemaPath 2>&1
  $migrateExit = $LASTEXITCODE
  $migrateOutput | ForEach-Object { Write-Host $_ }

  if ($migrateExit -eq 0) {
    Write-Host "[upgrade-local-sqlite] Done. Restart your services."
    exit 0
  }

  $joined = ($migrateOutput | Out-String)
  if ($joined -match "P3005") {
    Write-Host ""
    Write-Host "[upgrade-local-sqlite] Prisma reported P3005 (schema not empty / not baselined)."
    Write-Host "[upgrade-local-sqlite] This is common for long-lived local SQLite installs."
    Write-Host ""
    Write-Host "If your upgrade is additive metadata only, apply the known safe additive column manually:"
    Write-Host ""
    Write-Host "  ALTER TABLE ContentItem ADD COLUMN primaryTopic TEXT;"
    Write-Host ""
    Write-Host "Then run:"
    Write-Host ""
    Write-Host "  cd apps/api"
    Write-Host "  npx prisma generate --schema prisma/schema.prisma"
    Write-Host ""
    Write-Host "And restart:"
    Write-Host ""
    Write-Host "  npm run dev:down"
    Write-Host "  npm run dev:up"
    Write-Host ""
    Write-Host "See: docs/UPGRADING_LOCAL_NODE.md"
    exit 2
  }

  Write-Host "[upgrade-local-sqlite] migrate deploy failed for a reason other than P3005."
  exit $migrateExit
}
finally {
  Pop-Location
}

