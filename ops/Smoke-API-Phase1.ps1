[CmdletBinding()]
param(
  [string]$Base = $env:MBAPP_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$Tenant = $env:MBAPP_TENANT ?? "DemoTenant"
)

$Headers = @{ "x-tenant-id" = $Tenant; "content-type" = "application/json" }

function Assert($cond, $msg) {
  if (-not $cond) { throw "❌ $msg" } else { Write-Host "✅ $msg" }
}
function GET($path)  { Invoke-RestMethod -Method GET    -Headers $Headers -Uri "$Base$path" }
function POST($p,$b) { Invoke-RestMethod -Method POST   -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 6) }
function PUT($p,$b)  { Invoke-RestMethod -Method PUT    -Headers $Headers -Uri "$Base$p" -Body ($b | ConvertTo-Json -Depth 6) }

Write-Host "Smoke base: $Base  tenant: $Tenant"

# Health
$h = GET "/health"
Assert ($h.ok -eq $true) "/health ok"

# Clients
$c = POST "/clients" @{ type="client"; name="Smoke Client"; email=("smoke+" + (Get-Date -UFormat %s) + "@example.com") }
Assert ($c.id) "POST /clients -> id"
$cl = GET "/clients?limit=5"
Assert ($cl.items.Count -ge 1) "GET /clients list has items"
$cg = GET "/clients/$($c.id)"
Assert ($cg.id -eq $c.id) "GET /clients/{id} returns same id"
$cu = PUT "/clients/$($c.id)" @{ name="Smoke Client Updated" }
Assert ($cu.id -eq $c.id) "PUT /clients/{id} returns id"

# Resources
$r = POST "/resources" @{ type="resource"; name="Smoke Stall"; resourceType="stall"; location="Barn A" }
Assert ($r.id) "POST /resources -> id"
$rl = GET "/resources?limit=5"
Assert ($rl.items.Count -ge 1) "GET /resources list has items"
$rg = GET "/resources/$($r.id)"
Assert ($rg.id -eq $r.id) "GET /resources/{id} returns same id"
$ru = PUT "/resources/$($r.id)" @{ status="available" }
Assert ($ru.id -eq $r.id) "PUT /resources/{id} returns id"

Write-Host "🎉 SMOKE OK"
