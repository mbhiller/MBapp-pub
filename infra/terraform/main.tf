locals {
  name = var.project_name
}

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

data "archive_file" "api_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/build/api.zip"
}

resource "aws_iam_role" "api" {
  name = "${local.name}-api-role"

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
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  filename         = data.archive_file.api_zip.output_path
  source_code_hash = data.archive_file.api_zip.output_base64sha256
  role             = aws_iam_role.api.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
}

resource "aws_apigatewayv2_api" "http" {
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
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }
}
# CloudWatch Logs retention for the Lambda
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 14
}

# Alarm on HTTP API 5xx
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project_name}-httpapi-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  dimensions = {
    ApiId = aws_apigatewayv2_api.http.id
    Stage = "$default"
  }
}

resource "random_id" "suffix" {
  byte_length = 3
}

resource "aws_s3_bucket" "web" {
  bucket        = "${local.name}-web-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${local.name}-oac"
  description                       = "OAC for ${local.name} web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "cf_to_s3" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.cf_to_s3.json
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.web.id
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = aws_s3_bucket.web.id
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

resource "null_resource" "upload_web" {
  depends_on = [aws_cloudfront_distribution.web]

  provisioner "local-exec" {
    command = "echo \"<h1>MBapp Web via CloudFront</h1>\" > index.html && aws s3 cp index.html s3://${aws_s3_bucket.web.id}/index.html"
  }
}

output "http_api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}
output "web_bucket_name" { value = aws_s3_bucket.web.id }
output "cloudfront_distribution_id" { value = aws_cloudfront_distribution.web.id }

