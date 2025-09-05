############################
# Locals
############################
locals {
  name        = var.project_name
  name_prefix = "${var.project_name}-nonprod"
}

############################
# (Utility) Caller identity (optional)
############################
data "aws_caller_identity" "current" {}

############################
# DynamoDB (existing)
############################
resource "aws_dynamodb_table" "devices" {
  name         = "${local.name}-devices"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "scans" {
  name         = "${local.name}-scans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "scan_id"

  attribute {
    name = "scan_id"
    type = "S"
  }
}

############################
# Legacy API (gated by deploy_api)
############################

# Package legacy API code from ./lambda only if deploying it
data "archive_file" "api_zip" {
  count       = var.deploy_api ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/build/api.zip"
}

resource "aws_iam_role" "api" {
  count = var.deploy_api ? 1 : 0
  name  = "${local.name}-api-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action    = "sts:AssumeRole",
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  count      = var.deploy_api ? 1 : 0
  role       = aws_iam_role.api[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "api" {
  count = var.deploy_api ? 1 : 0

  function_name    = "${local.name}-api"
  filename         = data.archive_file.api_zip[0].output_path
  source_code_hash = data.archive_file.api_zip[0].output_base64sha256
  role             = aws_iam_role.api[0].arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
}

resource "aws_apigatewayv2_api" "http" {
  count         = var.deploy_api ? 1 : 0
  name          = "${local.name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["GET", "OPTIONS"]
    allow_origins     = var.allowed_origins
    max_age           = 86400
  }
}

resource "aws_lambda_permission" "api_invoke" {
  count         = var.deploy_api ? 1 : 0
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http[0].execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "lambda" {
  count                  = var.deploy_api ? 1 : 0
  api_id                 = aws_apigatewayv2_api.http[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  count     = var.deploy_api ? 1 : 0
  api_id    = aws_apigatewayv2_api.http[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda[0].id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  count       = var.deploy_api ? 1 : 0
  api_id      = aws_apigatewayv2_api.http[0].id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }
}

# CloudWatch Logs retention for legacy API Lambda
resource "aws_cloudwatch_log_group" "lambda" {
  count             = var.deploy_api ? 1 : 0
  name              = "/aws/lambda/${aws_lambda_function.api[0].function_name}"
  retention_in_days = 14
}

# Alarm on HTTP API 5xx
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = var.deploy_api ? 1 : 0
  alarm_name          = "${var.project_name}-httpapi-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  dimensions = {
    ApiId = aws_apigatewayv2_api.http[0].id
    Stage = "$default"
  }
}

############################
# Web (S3 + CloudFront) gated by deploy_web
############################

resource "random_id" "suffix" {
  count       = var.deploy_web ? 1 : 0
  byte_length = 3
}

resource "aws_s3_bucket" "web" {
  count         = var.deploy_web ? 1 : 0
  bucket        = "${local.name}-web-${random_id.suffix[0].hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  count  = var.deploy_web ? 1 : 0
  bucket = aws_s3_bucket.web[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "oac" {
  count                             = var.deploy_web ? 1 : 0
  name                              = "${local.name}-oac"
  description                       = "OAC for ${local.name} web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  count               = var.deploy_web ? 1 : 0
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.web[0].bucket_regional_domain_name
    origin_id                = aws_s3_bucket.web[0].id
    origin_access_control_id = aws_cloudfront_origin_access_control.oac[0].id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = aws_s3_bucket.web[0].id
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# S3 bucket policy to allow ONLY this distribution via OAC
data "aws_iam_policy_document" "cf_to_s3" {
  count = var.deploy_web ? 1 : 0

  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web[0].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  count  = var.deploy_web ? 1 : 0
  bucket = aws_s3_bucket.web[0].id
  policy = data.aws_iam_policy_document.cf_to_s3[0].json
}

resource "null_resource" "upload_web" {
  count      = var.deploy_web ? 1 : 0
  depends_on = [aws_cloudfront_distribution.web]

  provisioner "local-exec" {
    command = "echo \"<h1>MBapp Web via CloudFront</h1>\" > index.html && aws s3 cp index.html s3://${aws_s3_bucket.web[0].id}/index.html"
  }
}

############################
# Phase 4: Objects API (always on)
############################

# DynamoDB: Objects table
resource "aws_dynamodb_table" "objects" {
  name         = "${var.project_name}_objects"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  attribute {
    name = "gsi2pk"
    type = "S"
  }

  attribute {
    name = "gsi2sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "gsi2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  tags = {
    Project = var.project_name
    Env     = "nonprod"
  }
}

# IAM for Objects Lambda
data "aws_iam_policy_document" "objects_lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "objects_lambda_role" {
  name               = "${local.name_prefix}-objects-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.objects_lambda_assume.json
}

# Attach AWS managed basic logs policy
resource "aws_iam_role_policy_attachment" "objects_lambda_basic" {
  role       = aws_iam_role.objects_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Custom policy for DynamoDB access
data "aws_iam_policy_document" "objects_dynamo_policy_doc" {
  statement {
    sid     = "DynamoAccess"
    effect  = "Allow"
    actions = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [
      aws_dynamodb_table.objects.arn,
      "${aws_dynamodb_table.objects.arn}/index/*"
    ]
  }
}

resource "aws_iam_policy" "objects_dynamo_policy" {
  name   = "${local.name_prefix}-objects-dynamo-policy"
  policy = data.aws_iam_policy_document.objects_dynamo_policy_doc.json
}

resource "aws_iam_role_policy_attachment" "attach_objects_dynamo_policy" {
  role       = aws_iam_role.objects_lambda_role.name
  policy_arn = aws_iam_policy.objects_dynamo_policy.arn
}

# Log group for the Objects Lambda
resource "aws_cloudwatch_log_group" "objects_lambda_lg" {
  name              = "/aws/lambda/${local.name_prefix}-objects"
  retention_in_days = var.log_retention_days
}

# Lambda (Objects)
resource "aws_lambda_function" "objects" {
  function_name = "${local.name_prefix}-objects"
  role          = aws_iam_role.objects_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      OBJECTS_TABLE                       = aws_dynamodb_table.objects.name
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  depends_on = [aws_cloudwatch_log_group.objects_lambda_lg]
}

# HTTP API for Objects (+ CORS)
resource "aws_apigatewayv2_api" "objects_api" {
  name          = "${var.project_name}-nonprod-objects-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins     = var.allowed_origins
    allow_headers     = ["*"]
    allow_methods     = ["GET", "POST", "PUT", "OPTIONS"]
    allow_credentials = false
    max_age           = 86400
  }
}

resource "aws_apigatewayv2_integration" "objects_lambda_integration" {
  api_id                 = aws_apigatewayv2_api.objects_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.objects.arn
  payload_format_version = "2.0"
}

# Routes (match handler & smoke)
resource "aws_apigatewayv2_route" "post_objects" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "POST /objects/{type}"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "get_objects" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "GET /objects/{type}"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "get_objects_id" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "GET /objects/{type}/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "put_objects_id" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "PUT /objects/{type}/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "get_objects_search" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "GET /objects/search"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "get_tenants" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "GET /tenants"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

# Catch-all so unmatched paths still reach the Lambda (handy for diagnostics)
resource "aws_apigatewayv2_route" "default_objects" {
  api_id    = aws_apigatewayv2_api.objects_api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.objects_lambda_integration.id}"
}

resource "aws_apigatewayv2_stage" "objects_stage" {
  api_id      = aws_apigatewayv2_api.objects_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw_invoke_objects" {
  statement_id  = "AllowAPIGatewayInvokeObjects"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.objects.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.objects_api.execution_arn}/*/*"
}
