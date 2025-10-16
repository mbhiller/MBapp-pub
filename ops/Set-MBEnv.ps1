<# ======================================================================
 Set-MBEnv.ps1 — MBapp env bootstrap + optional dev-login + smoke helper
====================================================================== #>

[CmdletBinding()]
param(
  # Terraform state
  [string]$TfStateBucket = $null,
  [string]$TfLockTable   = $null,
  [string]$TfStateKey    = "mbapp/infra/terraform.tfstate",

  # Environment + repo
  [ValidateSet("nonprod","prod")] [string]$Env = "nonprod",
  [string]$RepoRoot = "C:\Users\bryan\MBapp-pub",
  [string]$Region   = "us-east-1",

  # API + tenancy
  [string]$ApiBase  = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$TenantId = "DemoTenant",
  [string]$ApiId    = "ki8kgivz1f",
  [string]$Lambda   = "mbapp-nonprod-objects",
  [string]$IntegrationId = "tdnoorp",
  [string]$AwsProfile    = "mbapp-nonprod-admin",

  # DDB keys
  [string]$Table_PK = "pk",
  [string]$Table_SK = "sk",
  [string]$COUNTERS_Table_PK = "pk",
  [string]$COUNTERS_Table_SK = "sk",

  # Auth (optional)
  [string]$DevEmail = "dev@example.com",
  [string]$JwtSecret = $null,
  [switch]$Login,

  # Utilities
  [switch]$Show,
  [switch]$TestAuth,
  [string]$Smoke
)

function Write-Info($msg) { Write-Host "[MB]" $msg -ForegroundColor Cyan }
function Write-Err($msg)  { Write-Host "[MB][ERR]" $msg -ForegroundColor Red }
function Write-Wrn($msg)  { Write-Warning $msg }
function _Ensure-Node()   { $null = & node -v 2>$null; if ($LASTEXITCODE -ne 0) { throw "Node.js not found on PATH" } }
function _Ensure-Repo()   { if (Test-Path $RepoRoot) { Set-Location $RepoRoot } else { Write-Wrn "RepoRoot not found: $RepoRoot" } }

function Set-MBEnv {
  # AWS
  $env:AWS_DEFAULT_REGION = $Region
  $env:AWS_REGION         = $Region
  $env:AWS_PROFILE        = $AwsProfile

  # MBapp core
  $env:MBAPP_ENV            = $Env
  $env:MBAPP_REPO_ROOT      = $RepoRoot
  $env:MBAPP_REGION         = $Region
  $env:MBAPP_API_BASE       = $ApiBase.TrimEnd('/')
  $env:MBAPP_TENANT_ID      = $TenantId
  $env:MBAPP_API_ID         = $ApiId
  $env:MBAPP_LAMBDA         = $Lambda
  $env:MBAPP_INTEGRATION_ID = $IntegrationId

  # DDB keys
  $env:MBAPP_TABLE_PK    = $Table_PK
  $env:MBAPP_TABLE_SK    = $Table_SK
  $env:MBAPP_COUNTERS_PK = $COUNTERS_Table_PK
  $env:MBAPP_COUNTERS_SK = $COUNTERS_Table_SK

  # Expo
  $env:EXPO_PUBLIC_ENV       = $Env
  $env:EXPO_PUBLIC_API_BASE  = $env:MBAPP_API_BASE
  $env:EXPO_PUBLIC_TENANT_ID = $TenantId

  # Terraform hints
  if ($TfStateBucket) { $env:TF_STATE_BUCKET = $TfStateBucket }
  if ($TfLockTable)   { $env:TF_LOCK_TABLE   = $TfLockTable }
  if ($TfStateKey)    { $env:TF_STATE_KEY    = $TfStateKey }

  # Optional secret + dev email
  if ($JwtSecret)  { $env:MBAPP_JWT_SECRET = $JwtSecret }
  if ($DevEmail)   { $env:MBAPP_DEV_EMAIL  = $DevEmail }
}

function Show-MBEnv {
  Write-Info ("AWS_PROFILE : {0}" -f ($env:AWS_PROFILE ?? "<unset>"))
  Write-Info ("REGION      : {0}" -f ($env:AWS_REGION ?? "<unset>"))
  Write-Info ("ENV         : {0}" -f ($env:MBAPP_ENV ?? "<unset>"))
  Write-Info ("API_BASE    : {0}" -f ($env:MBAPP_API_BASE ?? "<unset>"))
  Write-Info ("TENANT_ID   : {0}" -f ($env:MBAPP_TENANT_ID ?? "<unset>"))
  Write-Info ("API_ID      : {0}" -f ($env:MBAPP_API_ID ?? "<unset>"))
  Write-Info ("LAMBDA      : {0}" -f ($env:MBAPP_LAMBDA ?? "<unset>"))
  Write-Info ("INTEGRATION : {0}" -f ($env:MBAPP_INTEGRATION_ID ?? "<unset>"))
  Write-Info ("TABLE PK/SK : {0}/{1}" -f ($env:MBAPP_TABLE_PK ?? "<unset>"), ($env:MBAPP_TABLE_SK ?? "<unset>"))
  Write-Info ("COUNTERS PK/SK : {0}/{1}" -f ($env:MBAPP_COUNTERS_PK ?? "<unset>"), ($env:MBAPP_COUNTERS_SK ?? "<unset>"))
  Write-Info ("TF STATE    : {0} {1} {2}" -f ($env:TF_STATE_BUCKET ?? "<unset>"), ($env:TF_LOCK_TABLE ?? "<unset>"), ($env:TF_STATE_KEY ?? "<unset>"))
  Write-Info ("DEV_EMAIL   : {0}" -f ($env:MBAPP_DEV_EMAIL ?? "<unset>"))
  Write-Info ("HAS_BEARER  : {0}" -f ([bool]$env:MBAPP_BEARER))
}

function Clear-MBBearer {
  Remove-Item Env:MBAPP_BEARER -ErrorAction SilentlyContinue
  Write-Info "Cleared MBAPP_BEARER"
}

function Set-MBBearer {
  if (-not $env:MBAPP_API_BASE)   { throw "MBAPP_API_BASE not set" }
  if (-not $env:MBAPP_TENANT_ID)  { throw "MBAPP_TENANT_ID not set" }
  $email = $env:MBAPP_DEV_EMAIL; if (-not $email) { $email = "dev@example.com" }

  $body = @{ email = $email; tenantId = $env:MBAPP_TENANT_ID } | ConvertTo-Json
  Write-Info "Dev-login → $($env:MBAPP_API_BASE)/auth/dev-login (tenant=$($env:MBAPP_TENANT_ID), email=$email)"

  try {
    $login = Invoke-RestMethod -Method Post -Uri "$($env:MBAPP_API_BASE)/auth/dev-login" `
              -ContentType "application/json" `
              -Headers @{ "X-Tenant-Id" = $env:MBAPP_TENANT_ID } `
              -Body $body
  } catch {
    Write-Err "Dev-login failed: $($_.Exception.Message)"
    throw
  }

  if (-not $login -or -not $login.token) {
    Write-Err "Dev-login returned no token. Response: $($login | ConvertTo-Json -Depth 5)"
    throw "No token"
  }

  $env:MBAPP_BEARER = $login.token
  Write-Info "MBAPP_BEARER set."
}

function Test-MBAuth {
  if (-not $env:MBAPP_API_BASE)  { throw "MBAPP_API_BASE not set" }
  if (-not $env:MBAPP_TENANT_ID) { throw "MBAPP_TENANT_ID not set" }

  $headers = @{
    "accept"        = "application/json"
    "Authorization" = "Bearer $($env:MBAPP_BEARER)"
    "X-Tenant-Id"   = $env:MBAPP_TENANT_ID
  }

  $tried = @()
  foreach ($path in @("/auth/me", "/tools/ping", "/ping")) {
    try {
      Write-Info "GET $($env:MBAPP_API_BASE)$path"
      $res = Invoke-RestMethod -Method Get -Uri "$($env:MBAPP_API_BASE)$path" -Headers $headers
      Write-Host ($res | ConvertTo-Json -Depth 6)
      return
    } catch {
      $tried += $path
      Write-Wrn "Probe failed at $path"
    }
  }
  throw "Auth probes failed at paths: $($tried -join ', ')"
}

function Invoke-MBSmoke {
  param([Parameter(Mandatory=$true)][string]$Test)
  _Ensure-Node
  if (-not $env:MBAPP_API_BASE)  { throw "MBAPP_API_BASE not set" }
  if (-not $env:MBAPP_TENANT_ID) { throw "MBAPP_TENANT_ID not set" }
  Write-Info "Running smoke: $Test"
  & node "ops/smoke/smoke.mjs" $Test
  if ($LASTEXITCODE -ne 0) { throw "Smoke failed (exit $LASTEXITCODE)" }
}

# --- Orchestrate ------------------------------------------------------------
_Ensure-Repo
Set-MBEnv

if ($Login -or (-not $env:MBAPP_BEARER -and $env:MBAPP_API_BASE -and $env:MBAPP_TENANT_ID)) {
  Set-MBBearer
}

if ($Show)     { Show-MBEnv }
if ($TestAuth) { Test-MBAuth }
if ($Smoke)    { Invoke-MBSmoke -Test $Smoke }
