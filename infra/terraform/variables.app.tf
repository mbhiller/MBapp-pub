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
