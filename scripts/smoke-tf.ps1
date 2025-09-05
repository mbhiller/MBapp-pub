param(
  [string]$Tenant = "DemoTenant",
  [string]$Type   = "horse",
  # Relative to the repo root
  [string]$TfDir  = "infra/terraform",
  # Optional explicit API override
  [string]$Api
)

$ErrorActionPreference = "Stop"

# Resolve repo root based on this script's location (…/scripts)
$scriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir "..")
$tfPath    = Resolve-Path (Join-Path $repoRoot $TfDir) -ErrorAction SilentlyContinue

function Get-TfOut([string]$name) {
  $terraform = (Get-Command terraform -ErrorAction SilentlyContinue)?.Path
  if (-not $terraform) { return $null }
  if (-not $tfPath)    { return $null }
  Push-Location $tfPath
  try {
    & $terraform output -raw $name 2>$null
  } catch {
    $null
  } finally {
    Pop-Location
  }
}

# Resolve API (param > TF outputs)
if (-not $Api) {
  $Api = Get-TfOut "objects_api_url"
  if (-not $Api) { $Api = Get-TfOut "objects_api_base_url" }
}

if (-not $Api) {
  $msg = @()
  if (-not $tfPath) { $msg += "Terraform dir not found: $TfDir (looked under $repoRoot)" }
  if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) { $msg += "Terraform CLI not found on PATH." }
  $msg += "No API found. Either:"
  $msg += "  - Run: terraform -chdir=$TfDir apply   (to populate outputs), or"
  $msg += "  - Pass API explicitly: npm run smoke:tf -- -Api https://<id>.execute-api.us-east-1.amazonaws.com"
  throw ($msg -join "`n")
}

Write-Host "Using API: $Api"
node (Join-Path $repoRoot "scripts/smoke-robust-v3-20250904-164502.mjs") --api="$Api" --tenant="$Tenant" --type="$Type"