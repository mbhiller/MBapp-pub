
variable "environment" { type = string }
variable "objects_table_name" { type = string }
variable "devices_table_name" { type = string }
variable "scans_table_name"   { type = string }

# Objects table (matches your current live schema)
resource "aws_dynamodb_table" "objects" {
  name         = var.objects_table_name
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
  attribute {
    name = "sku_lc"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
    read_capacity   = 0
    write_capacity  = 0
  }

  global_secondary_index {
    name            = "gsi2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
    read_capacity   = 0
    write_capacity  = 0
  }

  global_secondary_index {
    name            = "gsi3_sku"
    hash_key        = "sku_lc"
    projection_type = "ALL"
    read_capacity   = 0
    write_capacity  = 0
  }

  point_in_time_recovery {
    enabled                 = true
    recovery_period_in_days = 35
  }

  server_side_encryption {
    enabled = true
  }

  ttl {
    enabled = false
  }
}

# Devices table (minimal)
resource "aws_dynamodb_table" "devices" {
  name         = var.devices_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    enabled = false
  }
}

# Scans table (minimal)
resource "aws_dynamodb_table" "scans" {
  name         = var.scans_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "scan_id"

  attribute {
    name = "scan_id"
    type = "S"
  }

  ttl {
    enabled = false
  }
}
