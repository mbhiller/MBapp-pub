# ops/Smoke-Dev.ps1
$ErrorActionPreference = "Stop"

if (-not $env:MBAPP_API_BASE -or -not $env:MBAPP_TENANT_ID -or -not $env:MBAPP_BEARER) {
  throw "Set MBAPP_API_BASE, MBAPP_TENANT_ID, MBAPP_BEARER first (e.g., .\ops\Set-MBEnv.ps1 then .\ops\Login-Dev.ps1)."
}

Write-Host "Running smokes against $($env:MBAPP_API_BASE) as tenant $($env:MBAPP_TENANT_ID)..." -ForegroundColor Cyan
node .\apps\api\src\tools\smoke-dev.mjs
