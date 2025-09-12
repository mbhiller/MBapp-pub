[CmdletBinding()]
param(
  # Defaults to repo root = parent of /ops
  [string]$RepoRoot,

  # Defaults from env or sensible fallbacks
  [string]$Region,
  [string]$Environment,

  # Lambda name; default: "mbapp-<env>-objects"
  [string]$Lambda,

  # If set, runs npm install/ci before build
  [switch]$Install
)

# --- Resolve defaults ---------------------------------------------------------
if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
if (-not $Region) {
  $Region = if ($env:MBAPP_REGION) { $env:MBAPP_REGION } else { "us-east-1" }
}
if (-not $Environment) {
  $Environment = if ($env:MBAPP_ENV) { $env:MBAPP_ENV } else { "nonprod" }
}
if (-not $Lambda -or [string]::IsNullOrWhiteSpace($Lambda)) {
  $Lambda = if ($env:MBAPP_LAMBDA) { $env:MBAPP_LAMBDA } else { "mbapp-$Environment-objects" }
}

$apiDir = Join-Path $RepoRoot "apps\api"

Write-Host "RepoRoot:   $RepoRoot"
Write-Host "API Dir:    $apiDir"
Write-Host "Region:     $Region"
Write-Host "Env:        $Environment"
Write-Host "Lambda:     $Lambda"
if ($env:AWS_PROFILE) { Write-Host "AWS Profile: $env:AWS_PROFILE" }

# --- Pre-flight checks --------------------------------------------------------
if (-not (Test-Path $apiDir)) {
  throw "API directory not found: $apiDir"
}

$aws = Get-Command aws -ErrorAction SilentlyContinue
if (-not $aws) { throw "AWS CLI not found in PATH. Install AWS CLI v2 and retry." }

# Prepare common AWS args
$awsArgs = @("--region", $Region)
if ($env:AWS_PROFILE) { $awsArgs += @("--profile", $env:AWS_PROFILE) }

# Check creds (helpful warning but do not stop)
$null = & aws @awsArgs sts get-caller-identity 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "AWS credentials aren’t loaded for profile '$($env:AWS_PROFILE)'. If this fails, run: aws sso login --profile $env:AWS_PROFILE"
}

# --- Build & Package ----------------------------------------------------------
Push-Location $apiDir
try {
  if ($Install) {
    if (Test-Path (Join-Path $apiDir "package-lock.json")) { npm ci } else { npm install }
  }

  npm run build

  $dist = Join-Path $apiDir "dist"
  $entry = Join-Path $dist "index.js"
  if (-not (Test-Path $entry)) {
    throw "Build artifact not found: $entry. Ensure your build outputs to 'dist' and handler is 'dist/index.handler'."
  }

  # Zip the *folder* so handler path stays 'dist/index.handler'
  $zip = Join-Path $dist "bundle.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host "Zipping folder: $dist -> $zip" -ForegroundColor Cyan
  Compress-Archive -Path $dist -DestinationPath $zip -Force

  # --- Deploy code (create if missing, otherwise update) ----------------------
  $fn = & aws @awsArgs lambda get-function --function-name $Lambda --query 'Configuration.FunctionName' --output text 2>$null
  $exists = ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($fn))

  if (-not $exists) {
    Write-Host "Lambda '$Lambda' not found — creating..." -ForegroundColor Yellow

    $roleName = "mbapp-$Environment-objects-lambda-role"
    $roleArn  = & aws @awsArgs iam get-role --role-name $roleName --query Role.Arn --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($roleArn)) {
      throw "IAM role '$roleName' not found. Make sure Terraform applied IAM (Option A)."
    }

    & aws @awsArgs lambda create-function `
      --function-name $Lambda `
      --role $roleArn `
      --runtime nodejs20.x `
      --handler "dist/index.handler" `
      --zip-file ("fileb://{0}" -f $zip) | Out-Null

    # wait until function exists
    & aws @awsArgs lambda wait function-exists --function-name $Lambda
  }
  else {
    Write-Host "Updating Lambda code for '$Lambda'..." -ForegroundColor Cyan
    & aws @awsArgs lambda update-function-code `
      --function-name $Lambda `
      --zip-file ("fileb://{0}" -f $zip) | Out-Null

    # wait for update to complete
    & aws @awsArgs lambda wait function-updated --function-name $Lambda
  }

  Write-Host "Publish complete: $Lambda ($Region)" -ForegroundColor Green
}
finally {
  Pop-Location
}
