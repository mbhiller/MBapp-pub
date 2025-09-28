# tools/seed-post.ps1
param(
  [string]$ViewsPath = ".\apps\api\src\tools\seed\seed-views.json",
  [string]$WorkspacesPath = ".\apps\api\src\tools\seed\seed-workspaces.json"
)

if (-not $env:MBAPP_API_BASE -or -not $env:MBAPP_TENANT_ID -or -not $env:MBAPP_BEARER) {
  Write-Error "Please set MBAPP_API_BASE, MBAPP_TENANT_ID, MBAPP_BEARER first."
  exit 2
}

$headers = @{
  "content-type" = "application/json"
  "x-tenant-id"  = $env:MBAPP_TENANT_ID
  "authorization"= "Bearer $($env:MBAPP_BEARER)"
}

Write-Host "Seeding Views from $ViewsPath"
$views = Get-Content $ViewsPath -Raw | ConvertFrom-Json
$views | ForEach-Object {
  $b = $_ | ConvertTo-Json -Depth 12
  Invoke-RestMethod -Method Post -Uri "$($env:MBAPP_API_BASE)/views" -Headers $headers -Body $b
}

Write-Host "Seeding Workspaces from $WorkspacesPath"
$work = Get-Content $WorkspacesPath -Raw | ConvertFrom-Json
$work | ForEach-Object {
  $b = $_ | ConvertTo-Json -Depth 12
  Invoke-RestMethod -Method Post -Uri "$($env:MBAPP_API_BASE)/workspaces" -Headers $headers -Body $b
}

Write-Host "Seed complete."
