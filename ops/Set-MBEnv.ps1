[CmdletBinding()]
param(
  [string]$TfStateBucket = $null,
  [string]$TfLockTable = $null,
  [string]$TfStateKey = "mbapp/infra/terraform.tfstate",
  [ValidateSet("nonprod","prod")] [string]$Env = "nonprod",
  [string]$RepoRoot = "C:\Users\bryan\MBapp-pub",
  [string]$Region   = "us-east-1",
  [string]$ApiBase  = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$TenantId = "DemoTenant",
  [string]$ApiId    = "ki8kgivz1f",
  [string]$Lambda   = "mbapp-nonprod-objects",
  [string]$IntegrationId = "tdnoorp",
  [string]$AwsProfile = "mbapp-nonprod-admin"
)

if (Test-Path $RepoRoot) { Set-Location $RepoRoot }

$env:AWS_DEFAULT_REGION = $Region
$env:AWS_REGION = $Region
$env:AWS_PROFILE = $AwsProfile

$env:MBAPP_ENV = $Env
$env:MBAPP_REPO_ROOT = $RepoRoot
$env:MBAPP_REGION = $Region
$env:MBAPP_API_BASE = $ApiBase
$env:MBAPP_TENANT_ID = $TenantId
$env:MBAPP_API_ID = $ApiId
$env:MBAPP_LAMBDA = $Lambda
$env:MBAPP_INTEGRATION_ID = $IntegrationId

$env:EXPO_PUBLIC_ENV = $Env
$env:EXPO_PUBLIC_API_BASE = $ApiBase
$env:EXPO_PUBLIC_TENANT_ID = $TenantId

Write-Host "Environment set:" -ForegroundColor Cyan
[PSCustomObject]@{
  RepoRoot   = $RepoRoot
  Env        = $Env
  Region     = $Region
  ApiBase    = $ApiBase
  TenantId   = $TenantId
  ApiId      = $ApiId
  Lambda     = $Lambda
  IntegrationId = $IntegrationId
  AwsProfile = $AwsProfile
} | Format-List | Out-String | Write-Host

Write-Host "Tip: dot-source to persist: . `"$($MyInvocation.MyCommand.Path)`"" -ForegroundColor DarkGray


# Terraform backend config (optional)
if ($TfStateBucket) { $env:MBAPP_TFSTATE_BUCKET = $TfStateBucket }
if ($TfLockTable)   { $env:MBAPP_TFLOCK_TABLE  = $TfLockTable }
if ($TfStateKey)    { $env:MBAPP_TFSTATE_KEY   = $TfStateKey }
