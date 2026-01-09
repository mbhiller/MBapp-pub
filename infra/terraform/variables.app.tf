# Option A root variables (multi-line blocks)

variable "environment" {
  description = "Environment name (nonprod|prod)"
  type        = string
  default     = "nonprod"
}

variable "objects_table_name" {
  type    = string
  default = "mbapp_objects"
}

variable "devices_table_name" {
  type    = string
  default = "mbapp-devices"
}

variable "scans_table_name" {
  type    = string
  default = "mbapp-scans"
}

variable "lambda_function_name" {
  type    = string
  default = "mbapp-nonprod-objects"
}

variable "extra_managed_policy_arns" {
  description = "Optional extra IAM managed policies to attach to the lambda role"
  type        = list(string)
  default     = []
}

# Feature flag: enable creation of EventBridge schedules for background jobs
variable "enable_background_jobs" {
  description = "When true, creates EventBridge rule to invoke background jobs"
  type        = bool
  default     = false
}

# Schedule expression for background jobs (EventBridge rate or cron)
variable "background_jobs_schedule_expression" {
  description = "EventBridge schedule expression for background jobs"
  type        = string
  default     = "rate(10 minutes)"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "http_api_id" {
  description = "HTTP API Gateway ID for the objects API"
  type        = string
}

variable "objects_integration_id" {
  description = "API Gateway integration ID for objects endpoint"
  type        = string
  default     = ""
}
