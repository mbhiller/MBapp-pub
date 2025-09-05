param(
  [string]$TfDir = "infra/terraform",
  [string]$TfVarFile = "nonprod.tfvars",
  [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Join-Path -ChildPath ".." | Resolve-Path
Set-Location $repoRoot

# 1) Build zip
pwsh -File .\scripts\lambda-build.ps1

# 2) Deploy with Terraform (code hash changes → Lambda updates)
$applyArgs = @("-chdir=$TfDir", "apply", "-var-file=$TfVarFile")
if ($AutoApprove) { $applyArgs += "-auto-approve" }

terraform @applyArgs

# 3) Print API for convenience
try {
  $api = terraform -chdir=$TfDir output -raw objects_api_base_url
  if ($api) { Write-Host "API: $api" }
} catch {}


