param(
  [string] $Email = "dev@example.com",
  [string] $TenantId,                            # defaults to $env:MBAPP_TENANT_ID if omitted
  [switch] $PersistToken,                        # writes token to user env if set
  [switch] $VerboseHttp                          # shows request/response payloads
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- helpers --------------------------------------------------------

function Write-Info($msg)  { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host $msg -ForegroundColor Red }

function ConvertFrom-Base64Url([string]$b64url) {
  $padded = $b64url.Replace('-', '+').Replace('_', '/')
  switch ($padded.Length % 4) {
    2 { $padded += '==' }
    3 { $padded += '='  }
    0 { }
    default { }
  }
  [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($padded))
}

function Get-JwtPayload([string]$jwt) {
  if (-not $jwt) { return $null }
  $parts = $jwt.Split('.')
  if ($parts.Length -lt 2) { return $null }
  $json = ConvertFrom-Base64Url $parts[1]
  return $json | ConvertFrom-Json
}

function Invoke-Json($Method, $Url, $BodyObj, $Headers) {
  if ($VerboseHttp) {
    Write-Host "→ $Method $Url" -ForegroundColor DarkGray
    if ($BodyObj) { Write-Host ("  body: " + ($BodyObj | ConvertTo-Json -Depth 10)) -ForegroundColor DarkGray }
  }
  $resp = Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -ContentType "application/json" -Body ($BodyObj | ConvertTo-Json -Depth 10)
  if ($VerboseHttp) {
    Write-Host ("← " + ($resp | ConvertTo-Json -Depth 10)) -ForegroundColor DarkGray
  }
  return $resp
}

function Try-Health([string]$Base, [string]$Tenant, [string]$Bearer) {
  $results = @()

  $noAuthPaths = @(
    "/health",
    "/tools/health",
    "/.well-known/health",
    "/_health"
  )

  foreach ($p in $noAuthPaths) {
    try {
      $u = "$Base$p"
      $r = Invoke-WebRequest -Method Get -Uri $u -TimeoutSec 10
      $results += [pscustomobject]@{ path=$p; status=$r.StatusCode; ok=$true; authed=$false }
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      $results += [pscustomobject]@{ path=$p; status=$code; ok=$false; authed=$false }
    }
  }

  # simple authed pings
  $authedPaths = @(
    "/objects/product?limit=1",
    "/objects/purchaseOrder?limit=1",
    "/objects/salesOrder?limit=1"
  )
  foreach ($p in $authedPaths) {
    try {
      $u = "$Base$p"
      $h = @{ "x-tenant-id" = $Tenant }
      if ($Bearer) { $h["Authorization"] = "Bearer $Bearer" }
      $r = Invoke-RestMethod -Method Get -Uri $u -Headers $h
      $results += [pscustomobject]@{ path=$p; status=200; ok=$true; authed=$true }
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      $results += [pscustomobject]@{ path=$p; status=$code; ok=$false; authed=$true }
    }
  }

  return $results
}

# --- 1) Load env ----------------------------------------------------

if (Test-Path .\ops\Set-MBEnv.ps1) {
  Write-Info "Running .\ops\Set-MBEnv.ps1..."
  . .\ops\Set-MBEnv.ps1
} else {
  Write-Warn "No .\ops\Set-MBEnv.ps1 found; continuing with current env."
}

$Base   = $env:MBAPP_API_BASE
$Tenant = if ($TenantId) { $TenantId } elseif ($env:MBAPP_TENANT_ID) { $env:MBAPP_TENANT_ID } else { "DemoTenant" }
$Bearer = $env:MBAPP_BEARER

if (-not $Base) { throw "MBAPP_API_BASE is not set." }
Write-Info  "MBAPP_API_BASE: $Base"
Write-Info  "MBAPP_TENANT_ID: $Tenant"
Write-Info  ("MBAPP_BEARER: " + ($(if ($Bearer) { "(set)" } else { "(missing)" })))

# --- 2) Dev-login ---------------------------------------------------

# Build policy with exact reads + common actions
$policy = @{
  "*:read" = $true
  "*:write" = $true
  "product:read"       = $true
  "inventory:read"     = $true
  "purchaseorder:read" = $true
  "salesorder:read"    = $true
  "event:read"         = $true
  "registration:read"  = $true
  "resource:read"      = $true
  "reservation:read"   = $true

  "purchase:write"  = $true; "purchase:approve" = $true; "purchase:receive" = $true; "purchase:cancel" = $true; "purchase:close" = $true
  "sales:write"     = $true; "sales:commit"     = $true; "sales:fulfill"    = $true; "sales:cancel"   = $true; "sales:close"   = $true
  "registration:write" = $true
  "reservation:write"  = $true
  "tools:seed" = $true; "admin:reset" = $true
}

$body = @{
  email    = $Email
  tenantId = $Tenant
  roles    = @("admin")
  policy   = $policy
}

$paths = @("/auth/dev-login", "/dev-login", "/tools/dev-login")
$token = $null
$last  = $null
foreach ($p in $paths) {
  try {
    $url = "$Base$p"
    Write-Info "Trying dev-login: $url"
    $resp = Invoke-Json -Method Post -Url $url -BodyObj $body -Headers @{ "x-tenant-id" = $Tenant }
    if ($resp.token) {
      $token = $resp.token
      break
    } else {
      $last = $resp
    }
  } catch {
    $last = $_.Exception.Message
  }
}

if (-not $token) {
  Write-Err "Dev-login failed on all tried paths."
  if ($last) { Write-Host ("Last error: " + ($last | Out-String)) -ForegroundColor DarkRed }
  throw "Cannot continue without a token."
}

$env:MBAPP_BEARER = $token
Write-Ok "Token stored in MBAPP_BEARER (session). Length: $($token.Length)"

if ($PersistToken) {
  [System.Environment]::SetEnvironmentVariable("MBAPP_BEARER", $token, "User")
  Write-Ok "Token persisted to current user environment."
}

# --- 3) Decode & report roles/policy --------------------------------

$payload = Get-JwtPayload $token
if ($payload -and $payload.mbapp) {
  $roles = @()
  if ($payload.mbapp.roles) { $roles = @($payload.mbapp.roles) }
  $policyObj = $payload.mbapp.policy
  $policyKeys = @()
  if ($policyObj) {
    $policyKeys = ($policyObj.PSObject.Properties | ForEach-Object { $_.Name }) | Sort-Object
  }

  Write-Info "`nRoles:"
  if ($roles.Count) { $roles | ForEach-Object { Write-Ok " - $_" } } else { Write-Warn " (none)" }

  Write-Info "`nPolicy keys:"
  if ($policyKeys.Count) {
    $policyKeys | ForEach-Object { Write-Host " - $_" }
  } else {
    Write-Warn " (none)"
  }
} else {
  Write-Warn "Could not find mbapp.roles/policy in token payload."
}

# --- 4) Health checks -----------------------------------------------

Write-Info "`nHealth checks:"
$health = Try-Health -Base $Base -Tenant $Tenant -Bearer $token
$health | ForEach-Object {
  $color = if ($_.ok) { "Green" } else { "Yellow" }
  Write-Host (" " + ($_.authed ? "[auth]" : "[open]") + " " + $_.path + " => " + $_.status) -ForegroundColor $color
}

Write-Ok "`nInit complete."
