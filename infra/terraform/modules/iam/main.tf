
variable "region"       { type = string }
variable "environment"  { type = string }
variable "objects_table_name" { type = string }

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# IAM role for the objects lambda
resource "aws_iam_role" "objects_lambda_role" {
  name               = "mbapp-${var.environment}-objects-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Inline policy (matches current permissions you showed)
data "aws_iam_policy_document" "objects_ddb" {
  statement {
    sid     = "Describe"
    effect  = "Allow"
    actions = ["dynamodb:DescribeTable"]
    resources = [
      "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}"
    ]
  }
  statement {
    sid     = "RWCoreAndIndexes"
    effect  = "Allow"
    actions = [
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]
    resources = [
      "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}",
      "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}/index/gsi1",
      "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.objects_table_name}/index/gsi2"
    ]
  }
}

resource "aws_iam_role_policy" "objects_ddb_inline" {
  name   = "mbapp-objects-ddb"
  role   = aws_iam_role.objects_lambda_role.id
  policy = data.aws_iam_policy_document.objects_ddb.json
}

# Basic execution managed policy
resource "aws_iam_role_policy_attachment" "objects_lambda_basic" {
  role       = aws_iam_role.objects_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Optional extra managed policy (e.g., existing mbapp-nonprod-objects-dynamo-policy)
variable "extra_managed_policy_arns" {
  description = "Optional extra managed policy ARNs to attach to the role"
  type        = list(string)
  default     = []
}

resource "aws_iam_role_policy_attachment" "extra" {
  for_each   = toset(var.extra_managed_policy_arns)
  role       = aws_iam_role.objects_lambda_role.name
  policy_arn = each.value
}
