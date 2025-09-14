param(
  [string]$Api = $env:EXPO_PUBLIC_API_BASE,
  [string]$Tenant = $env:EXPO_PUBLIC_TENANT
)
if (-not $Api)    { $Api = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com" }
if (-not $Tenant) { $Tenant = "DemoTenant" }

$hdr = @{ "x-tenant-id" = $Tenant; "content-type" = "application/json"; "accept" = "application/json" }

Write-Host "MBapp smoke: $(Get-Date -Format s)"
Write-Host "API=$Api"
Write-Host "TENANT=$Tenant"
# Create
$body = @{ name="Sprint5 Smoke " + (Get-Random); sku="S5-" + (Get-Random); price=1.23; uom="each"; kind="good" } | ConvertTo-Json
$created = Invoke-RestMethod -Method POST "$Api/products" -Headers $hdr -Body $body
if (-not $created.id) { throw "Create failed" }
$id = $created.id
Write-Host "Created: $id"

# Update kind → service
$patch = @{ kind="service" } | ConvertTo-Json
$updated = Invoke-RestMethod -Method PUT "$Api/products/$id" -Headers $hdr -Body $patch
if ($updated.kind -ne "service") { throw "Update failed (kind not service)" }

# Get
$got = Invoke-RestMethod -Method GET "$Api/products/$id" -Headers $hdr
if ($got.id -ne $id) { throw "Get failed" }

# List
$list = Invoke-RestMethod -Method GET "$Api/products?limit=50" -Headers $hdr
$found = $list.items | Where-Object { $_.id -eq $id }
if (-not $found) { throw "List did not include created id" }

Write-Host "✅ All smoke steps passed"
