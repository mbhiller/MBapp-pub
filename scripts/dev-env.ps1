# scripts/dev-env.ps1
$env:API    = "https://u0cuyphbv6.execute-api.us-east-1.amazonaws.com"
$env:TENANT = "DemoTenant"
$env:TYPE   = "horse"

Write-Host "Set:"
Write-Host "  API    = $env:API"
Write-Host "  TENANT = $env:TENANT"
Write-Host "  TYPE   = $env:TYPE"
Write-Host "Try: npm run smoke:powershell"
