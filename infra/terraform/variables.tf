variable "project_name" {
  type        = string
  description = "Project name used as a prefix"
  default     = "mbapp"
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
  default     = "us-east-1"
}

variable "allowed_origins" {
  type        = list(string)
  default     = ["https://dyeahgvwe2bk3.cloudfront.net"] # after web is live, change to ["https://<your CF domain>"]
  description = "CORS allowlist"
}


variable "deploy_web" {
  type    = bool
  default = true
}

variable "deploy_api" {
  type    = bool
  default = true
}
