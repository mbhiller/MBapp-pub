# MBapp — Combined (Updated for Terraform Option A)
_Last updated: 2025-09-12 17:50 UTC_

This update captures our final **Terraform Option A** shape and the day‑to‑day ops flow. In Option A, **Terraform manages infrastructure** (DynamoDB, IAM, CloudWatch Log Group, API invoke permission), while **code deploys** happen via `ops/Publish-ObjectsLambda-EsbuildOnly.ps1`.

---

## What Terraform Manages vs. Scripts

**Terraform (infra/terraform):**
- **DynamoDB**
  - `mbapp_objects` (products + other objects)
  - `mbapp-devices`, `mbapp-scans` (placeholders / ready for future slices)
  - Indexes on **objects**:
    - `gsi1`: `gsi1pk=tenant|<type>`, `gsi1sk=updatedAt` (strings)
    - `gsi2` (optional): `gsi2pk=tenant|<type>`, `gsi2sk=name_lc`
    - `gsi3_sku`: `hash=sku_lc` (for fast SKU lookups)
- **IAM**
  - Role: `mbapp-<env>-objects-lambda-role`
  - Inline policy: DDB read/write on the tables + GSIs above
  - Managed: `AWSLambdaBasicExecutionRole`
- **CloudWatch Logs**
  - Log group: `/aws/lambda/mbapp-<env>-objects` (retention set in TF)
- **API Gateway permission**
  - `aws_lambda_permission` for HTTP API → Lambda _toggled_ by `create_invoke_permission` (bool)

**Scripts (ops):**
- `Publish-ObjectsLambda-EsbuildOnly.ps1` → **build + zip + create/update Lambda** code (handler `dist/index.handler`)
- `Set-MBEnv.ps1` → exports env for profile/region/API/Lambda/etc.
- `Tf-Init.ps1`, `Tf-PlanApply.ps1` → noninteractive backend init + plan/apply
- `Smoke-API.ps1` → POST/LIST/GET/PUT **/products** smoke with tenant header
- `Check-Routes.ps1` → prints current routes
- `Git-Push.ps1` → branch/commit/push helper
- (Optional) `Bootstrap-TerraformBackend.ps1`, `Align-And-Import-Routes-Simple.ps1`, `Import-Infra-OptionA.ps1` for new envs or importing legacy routes

---

## Terraform Layout (final)

```
infra/
  terraform/
    backend.tf                  # terraform { backend "s3" {} }
    backend.auto.tfbackend      # bucket/key/region/use_lockfile/encrypt
    versions.tf                 # required_providers (aws ~> 5.x)
    providers.tf                # provider "aws" (region via var)
    variables.app.tf            # environment, region, names/ids
    outputs.app.tf              # only outputs we actually use
    app_infra.tf                # wires modules below
    modules/
      ddb/      # tables + GSIs
      iam/      # role + inline + basic exec attachment
      lambda/   # CloudWatch log group only
      api/      # optional invoke permission (counted by flag)
```

### Backend configuration
Use **S3 backend** file **in the same folder** as your `terraform init`:
```hcl
# backend.tf
terraform {
  backend "s3" {}  # keep empty; details live in the .tfbackend file
}
```
```hcl
# backend.auto.tfbackend (no prompts, nonprod)
bucket  = "mbapp-tfstate-nonprod"
key     = "mbapp/infra/terraform.tfstate"
region  = "us-east-1"
use_lockfile = true     # replaces legacy dynamodb_table locking
encrypt = true
```

> Note: `dynamodb_table = "mbapp-terraform-locks"` is **deprecated** by Terraform; we use `use_lockfile=true`. Keeping the DDB lock table in AWS is harmless but unused by the backend.

### Root variables (subset)
```hcl
# variables.app.tf
variable "environment" { default = "nonprod" }
variable "region"      { default = "us-east-1" }

variable "http_api_id"          { description = "HTTP API id (e.g., ki8kgivz1f)" }
variable "lambda_function_name" { default = "mbapp-nonprod-objects" }

variable "objects_table_name" { default = "mbapp_objects" }
variable "devices_table_name" { default = "mbapp-devices" }
variable "scans_table_name"   { default = "mbapp-scans" }

variable "tags" { type = map(string), default = { Project = "mbapp", Env = "nonprod" } }
```

### Module wiring (root)
```hcl
# app_infra.tf
module "ddb" {
  source              = "./modules/ddb"
  environment         = var.environment
  objects_table_name  = var.objects_table_name
  devices_table_name  = var.devices_table_name
  scans_table_name    = var.scans_table_name
  tags                = var.tags
}

module "iam" {
  source              = "./modules/iam"
  environment         = var.environment
  region              = var.region
  objects_table_arn   = module.ddb.objects_arn
  objects_gsi_arns    = module.ddb.objects_gsi_arns   # gsi1/gsi2/gsi3_sku
  tags                = var.tags
}

module "lambda" {
  source             = "./modules/lambda"
  environment        = var.environment
  function_name      = var.lambda_function_name       # log group only
  tags               = var.tags
}

module "api" {
  source                   = "./modules/api"
  region                   = var.region
  http_api_id              = var.http_api_id
  lambda_function_name     = var.lambda_function_name
  create_invoke_permission = false   # flip to true after function exists
}
```

### Modules — notable bits
**`modules/ddb/main.tf`** (high level)
- Creates 3 tables (objects/devices/scans) with on‑demand billing
- `objects` has attributes: `pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk`, `sku_lc`
- GSIs: `gsi1` (tenant|type vs updatedAt), `gsi2` (optional name sort), `gsi3_sku` (sku_lc)

**`modules/iam/main.tf`** (high level)
- Role: `mbapp-<env>-objects-lambda-role` + trust `lambda.amazonaws.com`
- Inline policy grants: `dynamodb:Get/Put/Update/Delete/Query/Scan` on the table + `/index/*`
- Attach `AWSLambdaBasicExecutionRole`

**`modules/lambda/main.tf`**
- Only the **CloudWatch log group** for `mbapp-<env>-objects` (retention e.g. `14`)

**`modules/api/main.tf`**
```hcl
variable "create_invoke_permission" { type = bool, default = false }
data "aws_caller_identity" "current" {}

resource "aws_lambda_permission" "apigw_invoke_objects" {
  count               = var.create_invoke_permission ? 1 : 0
  statement_id_prefix = "AllowInvokeFromHttpApi-"
  action              = "lambda:InvokeFunction"
  function_name       = var.lambda_function_name
  principal           = "apigateway.amazonaws.com"
  source_arn          = "arn:aws:execute-api:${var.region}:${data.aws_caller_identity.current.account_id}:${var.http_api_id}/*/*/*"
}
```

---

## API Routes & Products

**Canonical** object routes (Lambda):  
- `POST /objects/{type}`  
- `GET /objects/{type}` (list)  
- `GET /objects/{type}/{id}`  
- `PUT /objects/{type}/{id}`  
- `GET /objects/search`

**Products** alias:  
- `POST /products` → `POST /objects/product`  
- `GET /products` → list/search product  
- `GET /products/{id}`  
- `PUT /products/{id}`

> We keep routes in API Gateway as-is. Terraform optionally manages them if imported (via one‑off script), but **day‑to‑day** we only keep the **invoke permission** in TF.

---

## Ops Runbook (nonprod)

```powershell
# 0) env + init
.\ops\Set-MBEnv.ps1
.\ops\Tf-Init.ps1

# 1) infra changes (DDB/IAM/Logs/API perm)
.\ops\Tf-PlanApply.ps1
.\ops\Tf-PlanApply.ps1 -Apply

# 2) code deploy
.\ops\Publish-ObjectsLambda-EsbuildOnly.ps1 -Install   # first time
.\ops\Publish-ObjectsLambda-EsbuildOnly.ps1            # subsequent

# 3) enable API invoke (once function exists)
#   in app_infra.tf: create_invoke_permission = true
.\ops\Tf-PlanApply.ps1
.\ops\Tf-PlanApply.ps1 -Apply

# 4) verify
.\ops\Check-Routes.ps1
.\ops\Smoke-API.ps1 -TailLogs
```

**Gotchas to avoid**
- `terraform init` must run **from** `infra/terraform` or use `-chdir`. Do **not** add a trailing path to `init` (causes “Too many command line arguments”).  
- Don’t set `TF_CLI_ARGS_init` to `-backend-config=$backendFile`. If you want convenience, use the **literal** file name: `-backend-config=backend.auto.tfbackend`.
- Backend locking: use `use_lockfile=true`; the old `dynamodb_table=` param is deprecated.
- Handler path: archive the **`dist/` folder**, not its contents → handler stays `dist/index.handler`.

---

## Product Model (persisted top‑level)

```jsonc
{
  "id": "...",
  "tenant": "DemoTenant",
  "type": "product",
  "sku": "SKU-123",
  "name": "Widget",
  "name_lc": "widget",
  "price": 12.34,
  "uom": "ea",
  "taxCode": "TX_STD",
  "kind": "good",
  "createdAt": 0,
  "updatedAt": 0
}
```

- **Uniq per tenant** on `sku` via token item: `UNIQ#<tenant>#product#SKU#<sku_lc>` (asserted in TransactWrite).
- **Indexes** provide list/search by tenant + type, name ordering, and SKU lookup.

---

## Smoke Test (happy path)
- POST `/products` → returns object with `id`
- GET `/products` → list includes the new product
- GET `/products/{id}` → returns the created product
- PUT `/products/{id}` → accepts update (e.g., price), returns updated object

See `ops/Smoke-API.ps1` for the exact flow.

---

## Change Log (Terraform slice)
- Replace backend locking with `use_lockfile=true` (remove `dynamodb_table=` from backend file).
- Split Terraform into modules: `ddb`, `iam`, `lambda` (log group only), `api` (optional permission).
- Remove legacy root files: `main.tf`, `variables.tf`, `outputs.tf` (moved into `app_infra.tf`, `variables.app.tf`, `outputs.app.tf`).
- Add ops scripts: `Tf-Init.ps1`, `Tf-PlanApply.ps1`, `Check-Routes.ps1`, `Smoke-API.ps1`, reworked `Publish-ObjectsLambda-EsbuildOnly.ps1`.
