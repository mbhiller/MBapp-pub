<#
.SYNOPSIS
  Create a test MBapp object (with name) and generate a QR code PNG containing JSON: { t, id, type, href }.

.EXAMPLES
  ./Make-JsonQr.ps1
  ./Make-JsonQr.ps1 -Type horse -Open
  ./Make-JsonQr.ps1 -Id "<existing-id>" -Type horse   # skip create, just make a QR
#>

param(
  [string]$ApiBase = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$Tenant  = "DemoTenant",
  [string]$Type    = "horse",
  [string]$Name,
  [string]$Id,
  [int]$Size       = 512,
  [string]$OutDir  = "./qr",
  [switch]$Open
)

$ErrorActionPreference = "Stop"

# Ensure defaults
if (-not $Name) {
  $utc = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $Name = "QR Smoke $utc"
}

# Headers per multi-tenant API
$hdr = @{
  "x-tenant-id"   = $Tenant
  "content-type"  = "application/json"
}

# Create if we don't have an id yet
if (-not $Id) {
  Write-Host "Creating test object: type=$Type name='$Name'"
  $bodyObj = @{ name = $Name }
  $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
  $create = Invoke-RestMethod -Method POST -Uri "$ApiBase/objects/$Type" -Headers $hdr -Body $bodyJson
  $Id = $create.id
  if (-not $Id) { throw "Create failed: no id returned" }
  Write-Host "Created id: $Id"
} else {
  Write-Host "Using existing id: $Id (type=$Type)"
}

# Build QR payload (JSON)
$payload = [ordered]@{
  t    = "mbapp/object-v1"
  id   = $Id
  type = $Type
  href = "/objects/$Type/$Id"
}
$payloadJson = ($payload | ConvertTo-Json -Depth 5 -Compress)

# Save the JSON alongside the PNG for reference
$baseName = "qr-object-$($Type)-$($Id)"
$jsonPath = [IO.Path]::Combine($OutDir, "$baseName.json")
$pngPath  = [IO.Path]::Combine($OutDir, "$baseName.png")
Set-Content -Path $jsonPath -Value $payloadJson -Encoding UTF8

# Generate QR using a reliable web encoder
$dataEnc = [System.Net.WebUtility]::UrlEncode($payloadJson)
$qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=$($Size)x$($Size)&data=$dataEnc"

Write-Host "Generating QR → $pngPath"
Invoke-WebRequest -Uri $qrUrl -OutFile $pngPath | Out-Null

Write-Host "Saved:"
Write-Host "  JSON: $jsonPath"
Write-Host "  PNG : $pngPath"

if ($Open) {
  try { Start-Process $pngPath } catch { Write-Warning "Couldn't open image: $_" }
}
