[CmdletBinding()]
param(
  [string]$Branch = "feature/products-kind",
  [string]$Message
)

if (-not $Message) { $Message = "chore: infra + api updates ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))" }

# ensure we're at repo root (script lives in /ops)
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

# create/switch branch
git rev-parse --verify $Branch 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  git checkout -b $Branch
} else {
  git checkout $Branch
}

git add -A
git commit -m $Message
git push -u origin $Branch
Write-Host "Pushed branch '$Branch' with commit: $Message" -ForegroundColor Green
