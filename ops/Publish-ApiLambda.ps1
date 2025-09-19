[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,   # repo root (MBapp-pub)
  [string]$Region    = $env:AWS_REGION ?? "us-east-1",
  [string]$Environment = $env:MBAPP_ENV ?? "dev",
  [string]$Lambda    = $null,                                   # default computed below
  [switch]$Install,                                             # run npm ci in apps/api
  [switch]$Tail,                                                # tail logs after deploy
  [switch]$DryRun                                               # print commands instead of executing
)

# Compute defaults
if (-not $Lambda) { $Lambda = "mbapp-$Environment-objects" }   # keep your historic name
$ApiDir = Join-Path $RepoRoot "apps\api"
$OutDir = Join-Path $ApiDir "dist"
$Zip    = Join-Path $OutDir "bundle.zip"
$Entry  = Join-Path $ApiDir "src\index.ts"

Write-Host "RepoRoot:     $RepoRoot"
Write-Host "API Dir:      $ApiDir"
Write-Host "Region:       $Region"
Write-Host "Environment:  $Environment"
Write-Host "Lambda:       $Lambda"
Write-Host "Entry:        $Entry"
Write-Host ""

function Run($cmd, [switch]$Quiet) {
  if ($DryRun) { Write-Host "DRYRUN> $cmd"; return 0 }
  if ($Quiet)  { Invoke-Expression $cmd | Out-Null; return $LASTEXITCODE }
  else         { Invoke-Expression $cmd; return $LASTEXITCODE }
}

# 1) Install deps (optional)
if ($Install) {
  Push-Location $ApiDir
  Run "npm ci"
  Pop-Location
}

# 2) Typecheck quickly (optional, best-effort)
if (Test-Path (Join-Path $ApiDir "tsconfig.json")) {
  Push-Location $ApiDir
  Run "npx tsc -p . --noEmit" -Quiet
  Pop-Location
}

# 3) Build with esbuild
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Push-Location $ApiDir
$esbuild = "npx esbuild `"$Entry`" --bundle --platform=node --target=node18 --format=cjs --outfile=`"$OutDir\index.js`" --external:aws-sdk"
Run $esbuild
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }
Pop-Location

# 4) Zip the bundle
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $Zip)

Write-Host "Bundle at: $Zip"

# 5) Update Lambda code
$update = "aws lambda update-function-code --function-name $Lambda --zip-file fileb://$Zip --region $Region"
Run $update

# 6) Optionally tail logs
if ($Tail) {
  Write-Host "Tailing logs. Ctrl+C to stop."
  Run "aws logs tail `"/aws/lambda/$Lambda`" --follow --region $Region"
}

Write-Host "Done."
