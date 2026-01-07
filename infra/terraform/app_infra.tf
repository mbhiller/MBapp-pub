
# Option A modules wiring
# (keeps current routes in main.tf; this file adds IAM, DDB, Lambda, and API permission)

# New variables live in variables.app.tf

module "iam" {
  source             = "./modules/iam"
  region             = var.region
  environment        = var.environment
  objects_table_name = var.objects_table_name

  # If you have existing managed policy ARNs, put them here:
  extra_managed_policy_arns = var.extra_managed_policy_arns
}

module "ddb" {
  source             = "./modules/ddb"
  environment        = var.environment
  objects_table_name = var.objects_table_name
  devices_table_name = var.devices_table_name
  scans_table_name   = var.scans_table_name
}

module "lambda" {
  source             = "./modules/lambda"
  environment        = var.environment
  function_name      = var.lambda_function_name
  objects_table_name = module.ddb.objects_name
}

module "api" {
  source                   = "./modules/api"
  region                   = var.region
  http_api_id              = var.http_api_id
  lambda_function_name     = var.lambda_function_name
  create_invoke_permission = true  # flip to true after the function exists
}

# EventBridge schedule to trigger background jobs (feature-flagged)
module "scheduler" {
  source                 = "./modules/scheduler"
  region                 = var.region
  lambda_function_name   = var.lambda_function_name
  enable_background_jobs = var.enable_background_jobs
  schedule_expression    = var.background_jobs_schedule_expression
}