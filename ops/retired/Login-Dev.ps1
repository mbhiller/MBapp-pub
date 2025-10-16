# ops/Login-Dev.ps1
param(
  [string]$ApiBase = $env:MBAPP_API_BASE,
  [string]$Tenant  = $env:MBAPP_TENANT_ID
)

$ErrorActionPreference = "Stop"

if (-not $ApiBase -or -not $Tenant) {
  throw "Please set MBAPP_API_BASE and MBAPP_TENANT_ID first (e.g., .\ops\Set-MBEnv.ps1)."
}

Write-Host "Minting dev token from API..." -ForegroundColor Cyan
$resp = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/dev-login" -ContentType "application/json" -Body "{}"
if (-not $resp.token) { throw "dev-login failed: $($resp | ConvertTo-Json -Depth 5)" }

$env:MBAPP_BEARER = $resp.token
Write-Host "MBAPP_BEARER set (len: $($env:MBAPP_BEARER.Length))" -ForegroundColor Green

# Quick policy check
$h = @{
  "content-type" = "application/json"
  "x-tenant-id"  = $Tenant
  "authorization"= "Bearer $($env:MBAPP_BEARER)"
}
$pol = Invoke-RestMethod -Method Get -Uri "$ApiBase/auth/policy" -Headers $h
Write-Host "Policy ok. Roles: $($pol.roles -join ', ')" -ForegroundColor Green
