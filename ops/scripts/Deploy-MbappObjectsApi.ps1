param(
  # Paths & names
  [string]$ProjectRoot = (Resolve-Path .).Path,
  [string]$LambdaName = "mbapp-objects-get",
  [string]$ApiName = "mbapp-http",
  [string]$LambdaSource = "src/objects/get.ts",

  # DynamoDB table & optional GSI for inference (/objects/{id})
  [Parameter(Mandatory=$true)][string]$ObjectsTableName,
  [string]$ByIdIndex = "",        # set to "byId" to enable inference
  [switch]$CreateGsiIfMissing,    # add GSI (HASH=id, RANGE=tenantId) if missing

  # Test values
  [string]$TenantId = "demo",
  [string]$TestType = "horse",
  [string]$TestId = "H-001"
)

$ErrorActionPreference = "Stop"
if (-not $env:AWS_REGION) { $env:AWS_REGION = "us-east-1" }

function Ensure-Tool($cmd, $help) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Missing tool '$cmd'. $help"
  }
}

function Ensure-Dir($p) {
  if (-not (Test-Path $p)) { New-Item -Path $p -ItemType Directory | Out-Null }
}

function Write-TfFile($path, $content) {
  if (-not (Test-Path $path)) {
    $content | Set-Content -NoNewline $path
  } else {
    $existing = Get-Content $path -Raw
    if ($existing -ne $content) { $content | Set-Content -NoNewline $path }
  }
}

function Ensure-Gsi {
  param([string]$Table, [string]$IndexName)

  $desc = aws dynamodb describe-table --table-name $Table | ConvertFrom-Json
  $gsis = $null
  if ($desc -and $desc.Table) { $gsis = $desc.Table.GlobalSecondaryIndexes }
  if (-not $gsis) { $gsis = @() }

  $exists = $false
  foreach ($g in $gsis) {
    if ($g.IndexName -eq $IndexName) { $exists = $true; break }
  }

  if ($exists) {
    Write-Host "GSI '$IndexName' already exists on table '$Table'."
    return
  }

  Write-Host "Creating GSI '$IndexName' on '$Table' (HASH=id, RANGE=tenantId)..."
  aws dynamodb update-table `
    --table-name $Table `
    --attribute-definitions AttributeName=id,AttributeType=S AttributeName=tenantId,AttributeType=S `
    --global-secondary-index-updates "[{`"Create`":{`"IndexName`":`"$IndexName`",`"KeySchema`":[{`"AttributeName`":`"id`",`"KeyType`":`"HASH`"},{`"AttributeName`":`"tenantId`",`"KeyType`":`"RANGE`"}],`"Projection`":{`"ProjectionType`":`"ALL`"}}}]"

  Write-Host "Waiting for GSI to become ACTIVE..."
  do {
    Start-Sleep -Seconds 5
    $desc = aws dynamodb describe-table --table-name $Table | ConvertFrom-Json
    $gsis = $null
    if ($desc -and $desc.Table) { $gsis = $desc.Table.GlobalSecondaryIndexes }
    if (-not $gsis) { $gsis = @() }
    $gsi = $gsis | Where-Object { $_.IndexName -eq $IndexName }
    $status = $gsi.IndexStatus
    Write-Host "  Status: $status"
  } while ($status -ne "ACTIVE")
}

# --- 0) Preflight -------------------------------------------------------------
Ensure-Tool "aws" "Install AWS CLI v2."
Ensure-Tool "terraform" "Install Terraform 1.6+."
Ensure-Tool "node" "Install Node.js 18+."
Ensure-Tool "npm" "Install Node.js (npm)."

$InfraDir   = Join-Path $ProjectRoot "infra/objects-get"
$DistDir    = Join-Path $InfraDir "dist"
$ZipPath    = Join-Path $InfraDir "dist/objects-get.zip"
$TfFiles    = @{
  "providers.tf" = @'
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  required_version = ">= 1.6.0"
}
provider "aws" { region = "us-east-1" }
'@

  "variables.tf" = @'
variable "objects_table_name" { type = string }
variable "lambda_zip_path"    { type = string, default = "${path.module}/dist/objects-get.zip" }
variable "by_id_index"        { type = string, default = "" }
variable "api_name"           { type = string, default = "mbapp-http" }
variable "lambda_name"        { type = string, default = "mbapp-objects-get" }
'@

  "iam.tf" = @'
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals { type = "Service", identifiers = ["lambda.amazonaws.com"] }
  }
}
resource "aws_iam_role" "lambda" {
  name               = "${var.lambda_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}
data "aws_iam_policy_document" "lambda_policy" {
  statement {
    sid       = "DynamoRead"
    actions   = ["dynamodb:GetItem","dynamodb:Query"]
    resources = [
      "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}",
      "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}/index/*"
    ]
  }
  statement {
    sid = "Logs"
    actions = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"]
    resources = ["*"]
  }
}
resource "aws_iam_policy" "lambda" { name = "${var.lambda_name}-policy", policy = data.aws_iam_policy_document.lambda_policy.json }
resource "aws_iam_role_policy_attachment" "attach" { role = aws_iam_role.lambda.name, policy_arn = aws_iam_policy.lambda.arn }
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
'@

  "lambda.tf" = @'
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.lambda_name}"
  retention_in_days = 14
}
resource "aws_lambda_function" "objects_get" {
  function_name = var.lambda_name
  role          = aws_iam_role.lambda.arn
  filename      = var.lambda_zip_path
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 8
  memory_size   = 256
  environment {
    variables = {
      TABLE_OBJECTS = var.objects_table_name
      BY_ID_INDEX   = var.by_id_index
      NODE_OPTIONS  = "--enable-source-maps"
    }
  }
  depends_on = [aws_cloudwatch_log_group.lambda]
}
'@

  "api-gw.tf" = @'
resource "aws_apigatewayv2_api" "http" {
  name          = var.api_name
  protocol_type = "HTTP"
  cors_configuration {
    allow_headers = ["*"]
    allow_methods = ["GET","OPTIONS"]
    allow_origins = ["*"]
  }
}
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.objects_get.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "get_object_canonical" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /objects/{type}/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}
resource "aws_apigatewayv2_route" "get_object_redirect" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /objects/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}
resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.objects_get.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
'@

  "outputs.tf" = @'
output "api_invoke_url" { value = aws_apigatewayv2_api.http.api_endpoint }
'@
}

# --- 1) Optional: create 'byId' GSI if requested --------------------------------
if ($ByIdIndex -and $CreateGsiIfMissing) {
  Ensure-Gsi -Table $ObjectsTableName -IndexName $ByIdIndex
}

# --- 2) Build Lambda bundle -----------------------------------------------------
Set-Location $ProjectRoot
if (-not (Test-Path "package-lock.json")) {
  Write-Host "Running ''npm install''..."
  npm install --no-audit --no-fund | Out-Null
} else {
  Write-Host "Running ''npm ci''..."
  npm ci --no-audit --no-fund | Out-Null
}

Ensure-Dir $InfraDir
Ensure-Dir $DistDir

# Use local esbuild if present; else npx
$srcPath = Join-Path $ProjectRoot $LambdaSource
if (-not (Test-Path $srcPath)) { throw "Lambda source not found: $srcPath" }

Write-Host "Bundling with esbuild..."
$esbuildLocal = Join-Path $ProjectRoot "node_modules/.bin/esbuild.cmd"
if (Test-Path $esbuildLocal) {
  & $esbuildLocal $srcPath --bundle --platform=node --target=node20 --sourcemap --outfile="$DistDir/index.js"
} else {
  npx --yes esbuild $srcPath --bundle --platform=node --target=node20 --sourcemap --outfile="$DistDir/index.js"
}

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $DistDir "*") -DestinationPath $ZipPath -Force
Write-Host "Created zip: $ZipPath"

# --- 3) Materialize Terraform for API+Lambda -----------------------------------
foreach ($kv in $TfFiles.GetEnumerator()) {
  $path = Join-Path $InfraDir $kv.Key
  Write-TfFile -path $path -content $kv.Value
}

# --- 4) Terraform deploy --------------------------------------------------------
Write-Host "Terraform init/apply..."
terraform -chdir=$InfraDir init -upgrade
$tfVars = @(
  "-var=objects_table_name=$ObjectsTableName",
  "-var=lambda_zip_path=$ZipPath",
  "-var=api_name=$ApiName",
  "-var=lambda_name=$LambdaName"
)
if ($ByIdIndex) { $tfVars += "-var=by_id_index=$ByIdIndex" }

terraform -chdir=$InfraDir apply -auto-approve @tfVars

$Api = terraform -chdir=$InfraDir output -raw api_invoke_url
Write-Host "API endpoint: $Api"

# --- 5) Smoke tests -------------------------------------------------------------
Write-Host "`n--- Smoke tests ---"
$hdr = @{ "x-tenant-id" = $TenantId }

# Canonical (no redirect)
try {
  $url1 = "$Api/objects/$TestType/$([uri]::EscapeDataString($TestId))"
  Write-Host "GET $url1"
  $r1 = Invoke-RestMethod -Method GET $url1 -Headers $hdr -MaximumRedirection 5 -TimeoutSec 15
  Write-Host "Canonical OK:`n$($r1 | ConvertTo-Json -Depth 8)"
} catch { Write-Warning "Canonical request failed: $($_.Exception.Message)" }

# Query helper (308 -> canonical)
try {
  $url2 = "$Api/objects/$([uri]::EscapeDataString($TestId))?type=$([uri]::EscapeDataString($TestType))"
  Write-Host "GET $url2"
  $r2 = Invoke-RestMethod -Method GET $url2 -Headers $hdr -MaximumRedirection 5 -TimeoutSec 15
  Write-Host "Query helper OK:`n$($r2 | ConvertTo-Json -Depth 8)"
} catch { Write-Warning "Query helper failed: $($_.Exception.Message)" }

# Inference helper (308 -> canonical), requires ByIdIndex and item present
if ($ByIdIndex) {
  try {
    $url3 = "$Api/objects/$([uri]::EscapeDataString($TestId))"
    Write-Host "GET $url3"
    $r3 = Invoke-RestMethod -Method GET $url3 -Headers $hdr -MaximumRedirection 5 -TimeoutSec 15
    Write-Host "Inference helper OK:`n$($r3 | ConvertTo-Json -Depth 8)"
  } catch { Write-Warning "Inference helper failed (did you set BY_ID_INDEX and have the item?): $($_.Exception.Message)" }
} else {
  Write-Host "Skipping inference test (no ByIdIndex specified)."
}
