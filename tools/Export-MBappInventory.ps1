param(
  [string]$Region = "us-east-1",
  [string]$ApiId  = "ki8kgivz1f"   # change if needed
)

$acct = (aws sts get-caller-identity --query Account --output text)
$api  = aws apigatewayv2 get-api --region $Region --api-id $ApiId | ConvertFrom-Json
$routes = (aws apigatewayv2 get-routes --region $Region --api-id $ApiId | ConvertFrom-Json).Items
$ints   = (aws apigatewayv2 get-integrations --region $Region --api-id $ApiId | ConvertFrom-Json).Items
$intMap = @{}; foreach ($i in $ints) { $intMap[$i.IntegrationId] = $i }

# Map routes -> Lambda function name (if Lambda proxy)
$routesEnriched = foreach ($r in $routes) {
  $iid = ($r.Target -split "/")[-1]
  $uri = $intMap[$iid].IntegrationUri
  $fn  = if ($uri -match "function:([^:]+)$") { $Matches[1] } else { $null }
  [pscustomobject]@{ RouteKey=$r.RouteKey; Target=$r.Target; Lambda=$fn }
}

# Lambdas (filter by prefix 'mbapp-')
$lambdas = aws lambda list-functions --region $Region `
  --query "Functions[?starts_with(FunctionName, 'mbapp-')].[FunctionName,Runtime,Handler,FunctionArn]" `
  --output json | ConvertFrom-Json

# Pull env for monolith (safe to add more functions here if desired)
$mono = aws lambda get-function-configuration --region $Region --function-name mbapp-nonprod-objects | ConvertFrom-Json

# DynamoDB table (known)
$dynamo = aws dynamodb describe-table --region $Region --table-name mbapp_objects | ConvertFrom-Json

$inv = [ordered]@{
  generatedAt = (Get-Date).ToString("s")
  region      = $Region
  accountId   = $acct
  api         = [ordered]@{
    id     = $ApiId
    name   = $api.Name
    url    = "https://$($ApiId).execute-api.$Region.amazonaws.com"
    routes = $routesEnriched
    integrations = $ints
  }
  lambdas = $lambdas | ForEach-Object {
    [ordered]@{
      name    = $_[0]; runtime = $_[1]; handler = $_[2]; arn = $_[3]
    }
  }
  monolith = [ordered]@{
    name    = $mono.FunctionName
    runtime = $mono.Runtime
    handler = $mono.Handler
    env     = $mono.Environment.Variables
  }
  dynamodb = [ordered]@{
    table  = $dynamo.Table.TableName
    keys   = $dynamo.Table.KeySchema
    gsis   = ($dynamo.Table.GlobalSecondaryIndexes | ForEach-Object { $_.IndexName })
  }
}

New-Item -Force -ItemType Directory -Path ops, docs | Out-Null
$inv | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 ops/inventory.json

# Minimal Markdown refresh (append/replace relevant bits)
$md = @"
# MBapp — Master Systems Doc (synced)
- **Region:** $Region
- **API ID:** $($inv.api.id)
- **Base URL:** $($inv.api.url)

## Routes → Lambda
$(
  $inv.api.routes | ForEach-Object { "* `$($_.RouteKey)` → `$($_.Lambda)` " } | Out-String
)

## Lambdas
$(
  $inv.lambdas | ForEach-Object { "* $($_.name)  ($($_.runtime), $($_.handler))" } | Out-String
)

## DynamoDB
- **Table:** $($inv.dynamodb.table)
- **Keys:** $(
  $inv.dynamodb.keys | ForEach-Object { "$($_.AttributeName): $($_.KeyType)" } -join ", "
)
- **GSIs:** $(
  if ($inv.dynamodb.gsis) { $inv.dynamodb.gsis -join ", " } else { "(none)" }
)
"@

Set-Content -Encoding UTF8 docs/MBapp-Master.md -Value $md

Write-Host "Wrote ops/inventory.json and docs/MBapp-Master.md"
