[CmdletBinding()]
param(
  [string]$Dir,
  [string]$Workspace,
  [string]$VarFile,
  [switch]$AutoApprove,
  [string[]]$Target
)

if (-not $Dir)       { $Dir = (Resolve-Path "$PSScriptRoot\..\infra\terraform").Path }
if (-not $Workspace) { if ($env:MBAPP_ENV) { $Workspace = $env:MBAPP_ENV } else { $Workspace = "dev" } }

Write-Host "Terraform Plan/Apply"
Write-Host "Dir:       $Dir"
Write-Host "Workspace: $Workspace"

Push-Location $Dir
terraform workspace select $Workspace | Out-Null

$args = @("plan","-out=tfplan")
if ($VarFile -and (Test-Path $VarFile)) { $args += @("-var-file",$VarFile) }
if ($Target) { foreach ($t in $Target) { $args += @("-target",$t) } }
terraform @args

if ($LASTEXITCODE -ne 0) { throw "terraform plan failed" }

$applyArgs = @("apply","tfplan")
if ($AutoApprove) { $applyArgs = @("apply","-auto-approve","tfplan") }
terraform @applyArgs
Pop-Location

Write-Host "Apply done."