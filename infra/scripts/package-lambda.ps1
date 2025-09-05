param(
  [string]$Entrypoint = "apps/api/src/index.ts",
  [string]$OutZip     = "infra/terraform/build/objects.zip"
)

$ErrorActionPreference = "Stop"

# Find repo root (prefer git); fallback to script's grandparent
$repo = (git rev-parse --show-toplevel) 2>$null
if (-not $repo) { $repo = (Resolve-Path "$PSScriptRoot\..\..").Path }
Set-Location $repo

# Ensure Node + deps installed
try { node -v | Out-Null } catch { throw "Node.js not found. Install Node 20+ and retry." }
if (-not (Test-Path ".\node_modules\esbuild")) {
  Write-Host "esbuild not installed. Installing dev deps at root..."
  npm install | Out-Null
  if (-not (Test-Path ".\node_modules\esbuild")) { throw "esbuild missing after npm install." }
}

# Paths
$buildDir = Join-Path $repo "infra/terraform/build"
$outJs    = Join-Path $buildDir "index.js"
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

# Run Node builder (no npx/Start-Process; avoids Win32 issues)
$builder = Join-Path $repo "infra/scripts/build-objects.mjs"
if (-not (Test-Path $builder)) { throw "Missing $builder. Please add build-objects.mjs." }

Write-Host "Bundling $Entrypoint → $outJs (esbuild Node API)..."
& node $builder --entry $Entrypoint --outfile $outJs
if ($LASTEXITCODE -ne 0) { throw "esbuild failed. See output above." }

# Zip handler as objects.zip with index.js at zip root
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
Compress-Archive -Path $outJs -DestinationPath $OutZip -Force

Write-Host "✅ Created $OutZip"
