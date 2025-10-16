[CmdletBinding()]
param(
  [string]$Dir,
  [string]$Workspace,
  [switch]$Upgrade,
  [switch]$Reconfigure,
  [string]$BackendConfigFile
)

if (-not $Dir)       { $Dir = (Resolve-Path "$PSScriptRoot\..\infra\terraform").Path }
if (-not $Workspace) { if ($env:MBAPP_ENV) { $Workspace = $env:MBAPP_ENV } else { $Workspace = "dev" } }

Write-Host "Terraform Init"
Write-Host "Dir:       $Dir"
Write-Host "Workspace: $Workspace"

Push-Location $Dir
$flags = @("init")
if ($Upgrade)     { $flags += "-upgrade" }
if ($Reconfigure) { $flags += "-reconfigure" }
if ($BackendConfigFile -and (Test-Path $BackendConfigFile)) {
  $flags += @("-backend-config", $BackendConfigFile)
}
terraform @flags

# workspace ensure
$ws = (terraform workspace list) -join "`n"
if ($ws -notmatch "^\*?\s*$Workspace\s*$") {
  Write-Host "Creating workspace $Workspace"
  terraform workspace new $Workspace
} else {
  Write-Host "Selecting workspace $Workspace"
  terraform workspace select $Workspace
}
Pop-Location

Write-Host "Init done."