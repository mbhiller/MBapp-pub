[CmdletBinding()]
param(
  [string]$Base,
  [string]$Tenant,
  [switch]$VerboseErrors
)

# ------------------------------
# Resolve Base/Tenant from envs
# ------------------------------
if (-not $Base) {
  if     ($env:MBAPP_API_BASE)        { $Base = $env:MBAPP_API_BASE }
  elseif ($env:EXPO_PUBLIC_API_BASE)  { $Base = $env:EXPO_PUBLIC_API_BASE }
  elseif ($env:MBAPP_BASE)            { $Base = $env:MBAPP_BASE }
  else {
    # Try to build from API ID + region
    if ($env:MBAPP_API_ID -and $env:AWS_REGION) {
      $Base = "https://$($env:MBAPP_API_ID).execute-api.$($env:AWS_REGION).amazonaws.com"
    } else {
      throw "No API base set. Pass -Base or set MBAPP_API_BASE / EXPO_PUBLIC_API_BASE (or MBAPP_API_ID + AWS_REGION)."
    }
  }
}
if (-not $Tenant) {
  if     ($env:MBAPP_TENANT_ID)       { $Tenant = $env:MBAPP_TENANT_ID }
  elseif ($env:EXPO_PUBLIC_TENANT_ID) { $Tenant = $env:EXPO_PUBLIC_TENANT_ID }
  elseif ($env:MBAPP_TENANT)          { $Tenant = $env:MBAPP_TENANT }
  else { $Tenant = "DemoTenant" }
}

# Sanitize base
$Base = ($Base -replace '"','' -replace "'","").Trim()
$Base = $Base.TrimEnd('/')
# Validate
$uriObj = $null
if (-not [System.Uri]::TryCreate($Base, [System.UriKind]::Absolute, [ref]$uriObj)) {
  throw "Invalid API base: [$Base] — expected something like https://<api-id>.execute-api.$($env:AWS_REGION).amazonaws.com"
}

$Headers = @{ "x-tenant-id" = $Tenant; "content-type" = "application/json" }

function Assert($cond, $msg) {
  if (-not $cond) { throw "❌ $msg" } else { Write-Host "✅ $msg" }
}
function GET($path)  {
  try { Invoke-RestMethod -Method GET -Headers $Headers -Uri "$Base$path" }
  catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw }
}
function POST($p,$b) {
  try { Invoke-RestMethod -Method POST -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 8) }
  catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw }
}
function PUT($p,$b)  {
  try { Invoke-RestMethod -Method PUT -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 8) }
  catch { if ($VerboseErrors) { $_ | Format-List * -Force }; throw }
}

Write-Host "Smoke → $Base  tenant=$Tenant"

# ------------------------------
# Health
# ------------------------------
$h = GET "/health"
Assert ($h.ok -eq $true) "/health ok"

# ------------------------------
# Clients CRUD
# ------------------------------
$ts = [int][double]::Parse((Get-Date -UFormat %s))
$c = POST "/clients" @{ type="client"; name="Smoke Client"; email=("smoke+$ts@example.com") }
Assert ($c.id) "POST /clients -> id returned"
$cl = GET "/clients?limit=5"
# 'items' might be null if empty; coerce to array count
$clCount = 0; if ($cl.items) { if ($cl.items -is [array]) { $clCount = $cl.items.Count } else { $clCount = 1 } }
Assert ($clCount -ge 1) "GET /clients list has items"
$cg = GET "/clients/$($c.id)"
Assert ($cg.id -eq $c.id) "GET /clients/{id} returns same id"
$cu = PUT "/clients/$($c.id)" @{ name="Smoke Client Updated" }
Assert ($cu.id -eq $c.id) "PUT /clients/{id} returns id"

# ------------------------------
# Resources CRUD
# ------------------------------
$r = POST "/resources" @{ type="resource"; name="Smoke Stall"; resourceType="stall"; location="Barn A" }
Assert ($r.id) "POST /resources -> id returned"
$rl = GET "/resources?limit=5"
$rlCount = 0; if ($rl.items) { if ($rl.items -is [array]) { $rlCount = $rl.items.Count } else { $rlCount = 1 } }
Assert ($rlCount -ge 1) "GET /resources list has items"
$rg = GET "/resources/$($r.id)"
Assert ($rg.id -eq $r.id) "GET /resources/{id} returns same id"
$ru = PUT "/resources/$($r.id)" @{ status="available" }
Assert ($ru.id -eq $r.id) "PUT /resources/{id} returns id"

# ------------------------------
# Generic objects sanity
# ------------------------------
$ol = GET "/objects/resource?limit=1"
$olCount = 0; if ($ol.items) { if ($ol.items -is [array]) { $olCount = $ol.items.Count } else { $olCount = 1 } }
Assert ($olCount -ge 0) "GET /objects/resource reachable"

Write-Host "🎉 API SMOKE OK"