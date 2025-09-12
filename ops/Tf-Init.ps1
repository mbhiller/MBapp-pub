[CmdletBinding()]
param(
  [string]$RepoRoot
)

if (-not $RepoRoot) { $RepoRoot = (Get-Location).Path }

$tfDir = Join-Path $RepoRoot "infra\terraform"
$backendFile = Join-Path $tfDir "backend.auto.tfbackend"

Write-Host "RepoRoot:     $RepoRoot"
Write-Host "Terraform dir: $tfDir"
Write-Host "Backend file:  $backendFile"

if (-not (Test-Path $tfDir))       { throw "Terraform dir not found: $tfDir" }
if (-not (Test-Path $backendFile)) { throw "Backend file not found: $backendFile" }

Push-Location $tfDir
try {
  terraform init -reconfigure -backend-config=$backendFile
}
finally {
  Pop-Location
}
