terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Wide but safe: any 5.x
      version = ">= 5.0, < 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0, < 4.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0, < 3.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.0, < 4.0"
    }
  }
}
