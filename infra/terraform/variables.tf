variable "project_name" {
  type        = string
  description = "Project name used as a prefix (e.g., 'mbapp')."
  default     = "mbapp"

  validation {
    condition     = can(regex("^[a-zA-Z0-9-_]+$", var.project_name))
    error_message = "project_name may only contain letters, numbers, dashes, and underscores."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}
variable "aws_profile" {
  type        = string
  description = "AWS CLI profile to use for Terraform."
  default     = "mbapp-nonprod"
}


variable "allowed_origins" {
  type        = list(string)
  description = "CORS allowlist for HTTP APIs (Objects API & legacy)."
  // Dev-friendly default. Override in tfvars for CloudFront prod domain.
  default = ["http://localhost:5173"]

  validation {
    condition     = length(var.allowed_origins) > 0
    error_message = "allowed_origins must include at least one origin."
  }
}

variable "deploy_web" {
  type        = bool
  description = "Whether to deploy the S3+CloudFront web stack."
  default     = false
}

variable "deploy_api" {
  type        = bool
  description = "Whether to deploy the legacy Lambda+HTTP API (separate from the Objects API)."
  default     = false
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to the *pre-built* Objects Lambda zip, relative to the Terraform working dir (infra/terraform)."
  // If you run 'terraform -chdir=infra/terraform ...', this path is resolved from infra/terraform
  default = "./build/objects.zip"

  validation {
    condition     = endswith(var.lambda_zip_path, ".zip")
    error_message = "lambda_zip_path must point to a .zip file."
  }
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs retention (days) for Lambda functions."
  default     = 14

  validation {
    condition     = var.log_retention_days >= 1 && var.log_retention_days <= 3653
    error_message = "log_retention_days must be between 1 and 3653 (10 years)."
  }
}
