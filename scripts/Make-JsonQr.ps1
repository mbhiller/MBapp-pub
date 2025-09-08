# Make-JsonQr.ps1
# Usage: .\Make-JsonQr.ps1            # creates a QR with test data and opens it
#        .\Make-JsonQr.ps1 -Type dog  # (optional) change type

[CmdletBinding()]
param(
  [string]$Type = 'horse',
  [int]$Size = 420,
  [switch]$Open
)

# Build a simple test payload your ScanScreen understands (no id => create on scan)
$ts   = Get-Date -Format 's'
$epc  = 'E200TEST' + (Get-Random -Minimum 100000 -Maximum 999999)
$payload = [ordered]@{
  type = $Type
  data = @{
    name = "Demo $Type $ts"
    tags = @{
      rfidEpc      = $epc
      friendlyName = "Demo $Type"
    }
  }
}

# Compact JSON
$json = $payload | ConvertTo-Json -Compress -Depth 10

# Output file (qr-horse-YYYYMMDD-HHMMSS.png)
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path (Get-Location) "qr-$($Type)-$stamp.png"

# Render via QuickChart
$enc  = [System.Uri]::EscapeDataString($json)
$qrUrl = "https://quickchart.io/qr?text=$enc&size=$Size&margin=2"

Write-Host "Payload JSON:" -ForegroundColor Cyan
Write-Host $json
Write-Host ""

try {
  Invoke-WebRequest -Uri $qrUrl -OutFile $outFile -ErrorAction Stop | Out-Null
  Write-Host "Saved: $outFile" -ForegroundColor Green
  if ($Open -or $true) { Start-Process $outFile | Out-Null }
} catch {
  Write-Error "Failed to fetch QR image. $_"
  exit 1
}
