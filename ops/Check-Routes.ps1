[CmdletBinding()]
param(
  [string]$ApiId = $env:MBAPP_API_ID,
  [string]$Region = $env:MBAPP_REGION ?? "us-east-1"
)

if (-not $ApiId) { throw "ApiId not set. Run .\ops\Set-MBEnv.ps1 first or pass -ApiId." }

$awsArgs = @("--region",$Region)
if ($env:AWS_PROFILE) { $awsArgs += @("--profile", $env:AWS_PROFILE) }

# List routes
$routes = & aws @awsArgs apigatewayv2 get-routes --api-id $ApiId | ConvertFrom-Json
$routes.items | Sort-Object routeKey | ForEach-Object {
  "{0,-8}  {1}" -f ($_.routeKey -split ' ')[0], $_.routeKey
}

# Show base URL
$base = "https://$ApiId.execute-api.$Region.amazonaws.com"
Write-Host "Base URL: $base" -ForegroundColor Cyan
