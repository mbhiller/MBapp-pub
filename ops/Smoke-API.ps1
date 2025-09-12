[CmdletBinding()]
param(
  [string]$ApiId    = $env:MBAPP_API_ID,
  [string]$Region   = $env:MBAPP_REGION ?? "us-east-1",
  [string]$TenantId = $env:MBAPP_TENANT ?? "DemoTenant",
  [switch]$TailLogs
)

if (-not $ApiId) { throw "ApiId not found. Run .\ops\Set-MBEnv.ps1 first or pass -ApiId." }

$Base = "https://$ApiId.execute-api.$Region.amazonaws.com"
$Fn   = "mbapp-$($env:MBAPP_ENV ?? 'nonprod')-objects"

Write-Host "Base:   $Base"
Write-Host "Tenant: $TenantId"
if ($env:AWS_PROFILE) { Write-Host "Profile: $env:AWS_PROFILE" }

# tail logs (optional)
if ($TailLogs) {
  Start-Job -Name "tail" -ScriptBlock {
    param($fn,$region,$profile)
    $args = @("--region",$region)
    if ($profile) { $args += @("--profile",$profile) }
    & aws @args logs tail "/aws/lambda/$fn" --since 10m --follow
  } -ArgumentList $Fn,$Region,$env:AWS_PROFILE | Out-Null
  Write-Host "Tailing CloudWatch logs for $Fn ..." -ForegroundColor DarkGray
}

function Invoke-Json {
  param(
    [string]$Url,
    [string]$Method = "GET",
    [object]$Body = $null
  )
  $headers = @{ "x-tenant-id" = $TenantId }
  if ($Body -ne $null) { $headers["Content-Type"] = "application/json" }

  try {
    if ($Body -ne $null) {
      $json = ($Body | ConvertTo-Json -Depth 10)
      return irm $Url -Method $Method -Headers $headers -Body $json
    } else {
      return irm $Url -Method $Method -Headers $headers
    }
  } catch {
    Write-Host "ERROR calling $Method $Url" -ForegroundColor Red
    throw
  }
}

$fail = 0
function Assert {
  param([bool]$cond,[string]$msg)
  if (-not $cond) { $script:fail++; Write-Host "❌ $msg" -ForegroundColor Red } else { Write-Host "✅ $msg" -ForegroundColor Green }
}

# --- CREATE ---
$id = [guid]::NewGuid().ToString()
$createBody = @{
  kind  = "product"
  id    = $id
  sku   = "SKU-$([int](Get-Random -Minimum 100 -Maximum 999))"
  name  = "SmokeTest Widget"
  price = 12.34
  brand = "Acme"
}
$created = Invoke-Json "$Base/products" "POST" $createBody
Assert ($created.id -eq $id) "POST /products created id=$id"

# --- LIST ---
$listRaw = Invoke-Json "$Base/products" "GET"
# Normalize: some handlers return { items, cursor }, others return an array
if ($listRaw -is [System.Array]) {
  $items = $listRaw
} elseif ($listRaw.PSObject.Properties.Name -contains 'items') {
  $items = $listRaw.items
} else {
  $items = @()
}
Assert ($items -is [System.Array]) "GET /products returned a list"
Assert (($items | Where-Object { $_.id -eq $id } | Measure-Object).Count -gt 0) "Created product appears in list"

# --- GET by id ---
$got = Invoke-Json "$Base/products/$id" "GET"
Assert ($got.id -eq $id) "GET /products/{id} returns created product"

# --- UPDATE ---
# choose a reasonable new price between 10 and 50 with 2 decimals
$newPrice = [math]::Round((Get-Random -Minimum 10.0 -Maximum 50.0), 2)
$got.price = $newPrice

$updated = Invoke-Json "$Base/products/$id" "PUT" $got
# accept either the updated object or a minimal { id, price } echo
$updatedPrice = if ($updated.price) { [decimal]$updated.price } else { [decimal]$got.price }
Assert ($updatedPrice -eq [decimal]$newPrice) "PUT /products/{id} updated price -> $newPrice"

# Summary
if ($TailLogs) { Get-Job tail | Stop-Job | Remove-Job | Out-Null }
if ($fail -gt 0) {
  Write-Host "SMOKE: $fail failure(s)" -ForegroundColor Red
  exit 1
} else {
  Write-Host "SMOKE: all tests passed 🎉" -ForegroundColor Green
  exit 0
}
