param(
  [string]$Id,
  [string]$Type = "horse",
  [string]$Name = "Comet",
  [string]$OutFile = ".\qr\object-demo.png"
)

if (-not $Id) { $Id = [guid]::NewGuid().ToString() }

# Compact JSON payload the app understands (ScanScreen.tsx)
$payload = @{
  t    = "mbapp/object-v1"
  id   = $Id
  type = $Type
  name = $Name
} | ConvertTo-Json -Compress

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

Write-Host "QR payload:" $payload
# Use npx to render the QR. We feed JSON via STDIN to avoid quoting issues.
$payload | npx --yes qrcode -o $OutFile

if (Test-Path $OutFile) {
  Write-Host "Saved QR:" (Resolve-Path $OutFile)
} else {
  Write-Error "Failed to create QR. Ensure Node+npx are installed and try again."
}
