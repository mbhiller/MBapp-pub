
variable "environment" { type = string }
variable "objects_table_name" { type = string }
variable "devices_table_name" { type = string }
variable "scans_table_name" { type = string }

# Objects table (matches current AWS state: pk/sk only, plus gsi4)
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
    name = "gsi4pk"
    type = "S"
  }
  attribute {
    name = "gsi4sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi4"
    hash_key        = "gsi4pk"
    range_key       = "gsi4sk"
    projection_type = "ALL"
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
