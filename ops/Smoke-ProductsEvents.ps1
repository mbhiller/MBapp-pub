[CmdletBinding()]
param(
  [string]$Base,
  [string]$Tenant,
  [switch]$VerboseErrors,
  [switch]$Write   # optional: create/update a sample product
)

# ------------------------------
# Resolve Base/Tenant from envs (your Set-MBEnv.ps1 names)
# ------------------------------
if (-not $Base) {
  if     ($env:MBAPP_API_BASE)        { $Base = $env:MBAPP_API_BASE }
  elseif ($env:EXPO_PUBLIC_API_BASE)  { $Base = $env:EXPO_PUBLIC_API_BASE }
  elseif ($env:MBAPP_BASE)            { $Base = $env:MBAPP_BASE }
  elseif ($env:MBAPP_API_ID -and $env:AWS_REGION) {
    $Base = "https://$($env:MBAPP_API_ID).execute-api.$($env:AWS_REGION).amazonaws.com"
  } else {
    throw "No API base set. Pass -Base or set MBAPP_API_BASE / EXPO_PUBLIC_API_BASE (or MBAPP_API_ID + AWS_REGION)."
  }
}
if (-not $Tenant) {
  if     ($env:MBAPP_TENANT_ID)       { $Tenant = $env:MBAPP_TENANT_ID }
  elseif ($env:EXPO_PUBLIC_TENANT_ID) { $Tenant = $env:EXPO_PUBLIC_TENANT_ID }
  elseif ($env:MBAPP_TENANT)          { $Tenant = $env:MBAPP_TENANT }
  else { $Tenant = "DemoTenant" }
}

# Sanitize & validate
$Base = ($Base -replace '"','' -replace "'","").Trim().TrimEnd('/')
$uriObj = $null
if (-not [System.Uri]::TryCreate($Base, [System.UriKind]::Absolute, [ref]$uriObj)) {
  throw "Invalid API base: [$Base] — expected like https://<api-id>.execute-api.$($env:AWS_REGION).amazonaws.com[/stage]"
}

$Headers = @{ "x-tenant-id" = $Tenant; "content-type" = "application/json" }
function Assert($cond, $msg) { if (-not $cond) { throw "❌ $msg" } else { Write-Host "✅ $msg" } }
function GET($p)  { try { Invoke-RestMethod -Method GET -Headers $Headers -Uri "$Base$p" }  catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw } }
function POST($p,$b) { try { Invoke-RestMethod -Method POST -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 8) } catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw } }
function PUT($p,$b)  { try { Invoke-RestMethod -Method PUT  -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 8) } catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw } }

Write-Host "Smoke (Products/Events) → $Base  tenant=$Tenant"

# ------------------------------
# PRODUCTS (known working explicit routes)
# ------------------------------
# GET /products
$plist = GET "/products?limit=5"
$pcnt = 0; if ($plist.items) { if ($plist.items -is [array]) { $pcnt = $plist.items.Count } else { $pcnt = 1 } }
Assert ($pcnt -ge 0) "GET /products responded"

# GET /products/{id} if we have one
if ($pcnt -ge 1) {
  $pid = ($plist.items | Select-Object -First 1).id
  if (-not $pid) { $pid = ($plist.items | Select-Object -First 1).Id }
  if ($pid) {
    $pget = GET "/products/$pid"
    Assert ($pget.id -or $pget.Id) "GET /products/{id} responded"
  }
}

# Optional: create/update a product (safe minimal body)
if ($Write) {
  $ts = [int][double]::Parse((Get-Date -UFormat %s))
  $sku = "SMK-P-$ts"
  $created = POST "/products" @{ type="product"; sku=$sku; name="Smoke Product $ts" }
  Assert ($created.id) "POST /products created id"
  $updated = PUT "/products/$($created.id)" @{ name="Smoke Product Updated $ts" }
  Assert ($updated.id -eq $created.id) "PUT /products/{id} updated"
}

# ------------------------------
# EVENTS (explicit ANY /events present; do read-only)
# ------------------------------
$elist = GET "/events?limit=5"
$ecnt = 0; if ($elist.items) { if ($elist.items -is [array]) { $ecnt = $elist.items.Count } else { $ecnt = 1 } }
Assert ($ecnt -ge 0) "GET /events responded"

if ($ecnt -ge 1) {
  $eid = ($elist.items | Select-Object -First 1).id
  if (-not $eid) { $eid = ($elist.items | Select-Object -First 1).Id }
  if ($eid) {
    $eget = GET "/events/$eid"
    Assert ($eget.id -or $eget.Id) "GET /events/{id} responded"
  }
}

Write-Host "🎉 PRODUCTS/EVENTS SMOKE OK"