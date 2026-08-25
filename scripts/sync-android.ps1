$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$downloadsPath = Join-Path $projectRoot 'public\downloads'
$backupPath = Join-Path ([System.IO.Path]::GetTempPath()) "tiny-outings-downloads-$PID"
$hadDownloads = Test-Path -LiteralPath $downloadsPath

function Import-RequiredViteEnvironment {
  $requiredNames = @('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY')
  $envPath = Join-Path $projectRoot '.env.local'
  $valuesFromFile = @{}

  if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $name = $matches[1]
        $value = $matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
          $value = $value.Substring(1, $value.Length - 2)
        }
        $valuesFromFile[$name] = $value
      }
    }
  }

  foreach ($name in $requiredNames) {
    $currentValue = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ([string]::IsNullOrWhiteSpace($currentValue) -and $valuesFromFile.ContainsKey($name)) {
      [Environment]::SetEnvironmentVariable($name, $valuesFromFile[$name], 'Process')
      $currentValue = $valuesFromFile[$name]
    }
    if ([string]::IsNullOrWhiteSpace($currentValue)) {
      throw "Android build stopped: $name is missing. Set it in the process environment or .env.local."
    }
  }
}

Import-RequiredViteEnvironment

if ($hadDownloads) {
  Move-Item -LiteralPath $downloadsPath -Destination $backupPath -Force
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $supabaseHost = ([Uri][Environment]::GetEnvironmentVariable('VITE_SUPABASE_URL', 'Process')).Host
  $compiledBundle = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist\assets') -Filter 'index-*.js' | Select-Object -First 1
  if (-not $compiledBundle -or -not (Select-String -LiteralPath $compiledBundle.FullName -SimpleMatch $supabaseHost -Quiet)) {
    throw 'Android build stopped: the compiled frontend does not contain the configured Supabase host.'
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
