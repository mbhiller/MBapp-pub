variable "region" {
  type = string
}

variable "lambda_function_name" {
  type = string
}

variable "enable_background_jobs" {
  type    = bool
  default = false
}

variable "schedule_expression" {
  description = "EventBridge schedule expression for background jobs"
  type        = string
  default     = "rate(10 minutes)"
}

data "aws_caller_identity" "current" {}

locals {
  function_arn = "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function/${var.lambda_function_name}"
  rule_name    = "mbapp-${var.lambda_function_name}-background-jobs"
  input_json   = jsonencode({ source = "mbapp.jobs", jobType = "all" })
}

resource "aws_cloudwatch_event_rule" "background_jobs" {
  count               = var.enable_background_jobs ? 1 : 0
  name                = local.rule_name
  description         = "MBapp background jobs trigger"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  count = var.enable_background_jobs ? 1 : 0
  rule  = aws_cloudwatch_event_rule.background_jobs[0].name
  arn   = local.function_arn
  input = local.input_json
}

resource "aws_lambda_permission" "allow_events_invoke" {
  count         = var.enable_background_jobs ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge-${local.rule_name}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.background_jobs[0].arn
}
