variable "environment" { type = string }
variable "function_name" { type = string }
variable "objects_table_name" { type = string }

# Option A: Terraform does NOT manage the Lambda function (code stays with your script).
# We only manage the function's log group for retention, etc.
resource "aws_cloudwatch_log_group" "objects_lg" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 14
}

output "objects_name" {
  value = var.function_name
}
