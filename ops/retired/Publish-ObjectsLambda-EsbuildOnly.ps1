[CmdletBinding()]
param(
  [string]$RepoRoot,   # repo root (MBapp-pub)
  [string]$Region,
  [string]$Environment,
  [string]$Lambda,     # default computed below
  [switch]$Install,    # run npm ci in apps/api
  [switch]$Tail,       # tail logs after deploy
  [switch]$DryRun      # print commands only
)

# Defaults
if (-not $RepoRoot)    { $RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path }
if (-not $Region)      { if ($env:AWS_REGION) { $Region = $env:AWS_REGION } else { $Region = "us-east-1" } }
if (-not $Environment) { if ($env:MBAPP_ENV)  { $Environment = $env:MBAPP_ENV } else { $Environment = "dev" } }
if (-not $Lambda)      { $Lambda = "mbapp-$Environment-objects" }  # keep historic name

$ApiDir   = Join-Path $RepoRoot "apps\api"
$OutDir   = Join-Path $ApiDir "dist"
$Entry    = Join-Path $ApiDir "src\index.ts"
$OutJs    = Join-Path $OutDir "index.js"

# IMPORTANT: put ZIP OUTSIDE of dist to avoid self-inclusion/locking on Windows
$ArtifactsDir = Join-Path $ApiDir "artifacts"
$Zip          = Join-Path $ArtifactsDir "bundle.zip"

Write-Host "RepoRoot:     $RepoRoot"
Write-Host "API Dir:      $ApiDir"
Write-Host "Region:       $Region"
Write-Host "Environment:  $Environment"
Write-Host "Lambda:       $Lambda"
Write-Host "Entry:        $Entry"
Write-Host "OutJs:        $OutJs"
Write-Host "Zip:          $Zip"
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

# 2) Typecheck (best-effort, no emit)
if (Test-Path (Join-Path $ApiDir "tsconfig.json")) {
  Push-Location $ApiDir
  Run "npx tsc -p . --noEmit" -Quiet
  Pop-Location
}

# 3) Build with esbuild → CommonJS for Node 18
New-Item -ItemType Directory -Force -Path $OutDir       | Out-Null
New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null
Push-Location $ApiDir
$esbuild = "npx esbuild `"$Entry`" --bundle --platform=node --target=node20 --format=cjs --outfile=`"$OutJs`" --external:aws-sdk"

Write-Host $esbuild
Run $esbuild
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }
Pop-Location

# 4) Zip (outside of dist). Retry a couple of times to dodge transient file locks.
if (Test-Path $Zip) { Remove-Item $Zip -Force -ErrorAction SilentlyContinue }
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ok = $false
for ($i=0; $i -lt 3 -and -not $ok; $i++) {
  try {
    # slight delay helps on Windows after fast builds
    Start-Sleep -Milliseconds 50
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $OutDir,
      $Zip,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $true  # includeBaseDirectory
    )
    $ok = $true
  } catch {
    if ($i -eq 2) { throw }
    Write-Warning "Zip attempt $($i+1) failed: $($_.Exception.Message). Retrying..."
    Start-Sleep -Milliseconds 200
  }
}

$fi = Get-Item $Zip
if (-not $fi -or $fi.Length -le 0) { throw "Zip is empty: $Zip" }
Write-Host "Bundle at: $Zip  ($([math]::Round($fi.Length/1kb,1)) KB)"

# 5) Update Lambda
$update = "aws lambda update-function-code --function-name `"$Lambda`" --zip-file fileb://$Zip --region $Region"
Run $update

# 6) Tail logs (optional)
if ($Tail) {
  Write-Host "Tailing logs for /aws/lambda/$Lambda (Ctrl+C to stop)"
  Run "aws logs tail `"/aws/lambda/$Lambda`" --follow --region $Region"
}

Write-Host "Publish complete."
