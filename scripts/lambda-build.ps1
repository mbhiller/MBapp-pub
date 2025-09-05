param(
  # Entry file of your Lambda handler
  [string]$Entrypoint = "infra/lambda/index.ts",
  # Output folder (relative to repo root)
  [string]$OutDir     = "infra/terraform/build",
  # Output JS file name inside the zip
  [string]$OutFile    = "index.js",
  # Final zip name that Terraform references (must match nonprod.tfvars)
  [string]$ZipName    = "objects.zip"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Join-Path -ChildPath ".." | Resolve-Path
Set-Location $repoRoot

# Ensure output dir exists
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$jsPath  = Join-Path $OutDir $OutFile
$zipPath = Join-Path $OutDir $ZipName

Write-Host "Bundling $Entrypoint → $jsPath (Node 20, CJS)..."
npx esbuild $Entrypoint --bundle --platform=node --target=node20 --format=cjs --outfile=$jsPath

# Zip (index.js at zip root)
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $jsPath -DestinationPath $zipPath -Force

# Sanity: show size + timestamp
Get-Item $zipPath | Format-List Name,Length,LastWriteTime
Write-Host "✅ Built and zipped → $zipPath"
