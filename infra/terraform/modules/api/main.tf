variable "region" { type = string }
variable "http_api_id" { type = string }
variable "lambda_function_name" { type = string }

# New: make permission optional so apply doesn’t fail if the function isn't created yet
variable "create_invoke_permission" {
  type    = bool
  default = false
}

data "aws_caller_identity" "current" {}

resource "aws_lambda_permission" "apigw_invoke_objects" {
  count               = var.create_invoke_permission ? 1 : 0
  statement_id_prefix = "AllowInvokeFromHttpApi-"
  action              = "lambda:InvokeFunction"
  function_name       = var.lambda_function_name
  principal           = "apigateway.amazonaws.com"
  source_arn          = "arn:aws:execute-api:${var.region}:${data.aws_caller_identity.current.account_id}:${var.http_api_id}/*/*/*"
}
