param(
  [switch]$ShowToken = $false,
  [switch]$EmitTokenOnly = $false
)

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$path1  = Join-Path $here "..\Set-MBEnv.ps1"
$path2  = Join-Path $here "..\..\Set-MBEnv.ps1"
$script = if (Test-Path $path1) { (Resolve-Path $path1).Path }
          elseif (Test-Path $path2) { (Resolve-Path $path2).Path }
          else { Write-Error "Set-MBEnv.ps1 not found in ops/ or .ops/"; exit 1 }

if (-not $EmitTokenOnly) {
  if ($ShowToken) { . $script -Login -Show } else { . $script -Login }
}
else {
  # Emit-only mode: silence everything from Set-MBEnv.ps1
  . $script -Login *> $null
}

# Normalize: prefer MBAPP_BEARER, fallback to function, then DEV_API_TOKEN
if (-not $env:MBAPP_BEARER -and (Get-Command Get-MBDevToken -ErrorAction SilentlyContinue)) {
  $tok = Get-MBDevToken
  if ($tok) { $env:MBAPP_BEARER = "$tok" }
}

# Back-compat for anything still reading DEV_API_TOKEN
if (-not $env:DEV_API_TOKEN -and $env:MBAPP_BEARER) {
  $env:DEV_API_TOKEN = $env:MBAPP_BEARER
}

if (-not $env:MBAPP_BEARER -and -not $env:DEV_API_TOKEN) {
  Write-Error "No MBAPP_BEARER or DEV_API_TOKEN in environment after Set-MBEnv.ps1"
  exit 1
}

$token = $env:MBAPP_BEARER
if (-not $token) { $token = $env:DEV_API_TOKEN }

if ($EmitTokenOnly) {
  Write-Output $token
  exit 0
}

Write-Host "Token acquired."
if ($ShowToken) { Write-Host "(Shown due to -ShowToken)"; Write-Host $token }
