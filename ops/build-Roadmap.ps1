Param(
  [Parameter(Mandatory=$true)] [string]$Markdown,
  [Parameter(Mandatory=$true)] [string]$Logo,
  [string]$Title = "MBapp Roadmap vNext — Equestrian Operations Platform",
  [string]$Subtitle = "Executive & Technical Master Plan",
  [string]$OutPdf = "new_docs/MBapp-Roadmap-vNext.pdf",
  [ValidateSet("landscape","portrait")] [string]$Orientation = "landscape",
  [int]$WatermarkRotate = 30,
  [double]$WatermarkOpacity = 0.15
)

# Ensure node and npm
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js not found. Install from https://nodejs.org and re-run."
  exit 1
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$tools = Join-Path $root "tools/roadmap"
$dist = Join-Path $root "new_docs"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Push-Location $tools
if (-not (Test-Path "node_modules")) {
  npm i
}

node build-roadmap.js `
  --md "$Markdown" `
  --logo "$Logo" `
  --out "$OutPdf" `
  --title "$Title" `
  --subtitle "$Subtitle" `
  --orientation "$Orientation" `
  --wmRotate $WatermarkRotate `
  --wmOpacity $WatermarkOpacity

if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Error "Roadmap build failed."
  exit 1
}
Pop-Location
Write-Host "✅ Built $OutPdf"
