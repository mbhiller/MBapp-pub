[CmdletBinding()]
param(
  [ValidateSet("nonprod","prod")] [string]$Env = "nonprod",
  [string]$RepoRoot = $env:MBAPP_REPO_ROOT,
  [string]$AwsProfile = $env:AWS_PROFILE,
  [switch]$Plan,
  [switch]$Apply,
  [switch]$Destroy
)

if (-not $RepoRoot) { $RepoRoot = "C:\Users\bryan\MBapp-pub" }
$tfDir = Join-Path $RepoRoot "infra\terraform"
if (-not (Test-Path $tfDir)) { throw "Terraform dir not found at $tfDir" }
if (-not $AwsProfile) { $AwsProfile = "mbapp-$Env-admin" }

Write-Host "Terraform in $tfDir for $Env (profile $AwsProfile) ..." -ForegroundColor Cyan
$env:AWS_PROFILE = $AwsProfile

try { terraform version | Out-Null } catch { throw "Terraform CLI not found on PATH." }

# Provide TF_VARs so Terraform won't prompt
if ($env:MBAPP_REGION)         { $env:TF_VAR_region                 = $env:MBAPP_REGION }
if ($env:MBAPP_API_ID)         { $env:TF_VAR_http_api_id            = $env:MBAPP_API_ID }
if ($env:MBAPP_INTEGRATION_ID) { $env:TF_VAR_objects_integration_id = $env:MBAPP_INTEGRATION_ID }

Push-Location $tfDir
try {
  # Build backend-config flags (no subexpressions on lines)
  $initArgs = @()
  $bkt = $env:MBAPP_TFSTATE_BUCKET
  $key = $env:MBAPP_TFSTATE_KEY
  $tbl = $env:MBAPP_TFLOCK_TABLE
  $reg = $env:MBAPP_REGION
  $backendKey = if ($key) { $key } else { "mbapp/infra/terraform.tfstate" }
  $backendRegion = if ($reg) { $reg } else { "us-east-1" }
  if ($bkt) {
    $initArgs += "-backend-config=bucket=$bkt"
    $initArgs += "-backend-config=key=$backendKey"
    $initArgs += "-backend-config=region=$backendRegion"
    if ($tbl) { $initArgs += "-backend-config=dynamodb_table=$tbl" }
    $initArgs += "-backend-config=encrypt=true"
  }

  terraform init @initArgs

  if ($Plan -or (-not $Apply -and -not $Destroy)) {
    terraform plan -var-file "$Env.tfvars"
  }
  if ($Apply) {
    terraform apply -var-file "$Env.tfvars" -auto-approve
    Write-Host "`nOutputs:" -ForegroundColor Cyan
    terraform output
  }
  if ($Destroy) {
    terraform destroy -var-file "$Env.tfvars" -auto-approve
  }
}
finally {
  Pop-Location
}
