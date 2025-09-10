param(
  [ValidateSet("nonprod","prod")][string]$Env = "nonprod",
  [string]$ApiBase = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$Tenant  = "DemoTenant",
  [switch]$Persist
)

Write-Host "Setting Expo vars (Env=$Env, Tenant=$Tenant) ..."
$vars = @{
  EXPO_PUBLIC_ENV        = $Env
  EXPO_PUBLIC_API_BASE   = $ApiBase
  EXPO_PUBLIC_TENANT_ID  = $Tenant
}

if ($Persist) {
  foreach ($k in $vars.Keys) {
    [System.Environment]::SetEnvironmentVariable($k, $vars[$k], "User")
    Write-Host "Persisted $k=$($vars[$k]) (User scope)"
  }
  Write-Host "Open a NEW PowerShell window for persisted vars to take effect."
} else {
  foreach ($k in $vars.Keys) {
    Set-Item -Path "Env:$k" -Value $vars[$k]
    Write-Host "Session $k=$($vars[$k])"
  }
  Write-Host "Vars set for THIS PowerShell session."
}
