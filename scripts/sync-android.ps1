$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$downloadsPath = Join-Path $projectRoot 'public\downloads'
$backupPath = Join-Path ([System.IO.Path]::GetTempPath()) "tiny-outings-downloads-$PID"
$hadDownloads = Test-Path -LiteralPath $downloadsPath

if ($hadDownloads) {
  Move-Item -LiteralPath $downloadsPath -Destination $backupPath -Force
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location

  if ($hadDownloads -and (Test-Path -LiteralPath $backupPath)) {
    $publicPath = Join-Path $projectRoot 'public'
    if (-not (Test-Path -LiteralPath $publicPath)) {
      New-Item -ItemType Directory -Path $publicPath | Out-Null
    }
    Move-Item -LiteralPath $backupPath -Destination $downloadsPath -Force
  }
}
