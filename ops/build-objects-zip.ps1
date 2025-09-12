param(
  [string]$ApiDir = "apps/api",
  [string]$OutDir = "infra/terraform/build",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

# Paths
$repoRoot = (Resolve-Path ".").Path
$apiPath  = Join-Path $repoRoot $ApiDir
$outPath  = Join-Path $repoRoot $OutDir
$zipPath  = Join-Path $outPath "objects.zip"
$stageDir = Join-Path $apiPath "lambda_stage"

Write-Host "Repo root: $repoRoot"
Write-Host "API path : $apiPath"
Write-Host "Out dir  : $outPath"
Write-Host "Zip path : $zipPath"

if ($Clean) {
  if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
  if (Test-Path $zipPath)  { Remove-Item -Force $zipPath }
}

# Ensure out dir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

Push-Location $apiPath
try {
  # 1) Install production deps
  if (Test-Path "package-lock.json") {
    npm ci --omit=dev
  } else {
    npm install --omit=dev
  }

  # 2) Build TS -> dist (expects your tsconfig/build script to emit dist/index.js)
  if (Test-Path "package.json") {
    $pkg = Get-Content package.json | ConvertFrom-Json
    if ($pkg.scripts.build) {
      npm run build
    } else {
      # fallback: tsc
      npx tsc
    }
  } else {
    npx tsc
  }

  # 3) Stage files for Lambda
  if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

  # Keep dist/ at the root of the zip since handler is "dist/index.handler"
  Copy-Item -Recurse -Force "dist" $stageDir

  # Include node_modules so @aws-sdk/* is available in Lambda
  if (Test-Path "node_modules") {
    Copy-Item -Recurse -Force "node_modules" (Join-Path $stageDir "node_modules")
  }

  # Include minimal metadata if you want (optional)
  Copy-Item -Force "package.json" $stageDir -ErrorAction SilentlyContinue

  # 4) Zip
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

  Write-Host "✅ Built $zipPath"
}
finally {
  Pop-Location
}
