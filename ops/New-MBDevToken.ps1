# ops/New-MBDevToken.ps1
param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

# Run the Node minting script (it auto-reads apps/api/.env)
node "$RepoRoot\apps\api\src\tools\dev-login.mjs"

# Load token into this shell's env var
$tokenPath = Join-Path $RepoRoot ".mbapp.dev.jwt"
if (-not (Test-Path $tokenPath)) {
  throw "Token file not found at $tokenPath. Did dev-login fail?"
}

$env:MBAPP_BEARER = Get-Content $tokenPath -Raw
Write-Host "MBAPP_BEARER set (length: $($env:MBAPP_BEARER.Length))"
