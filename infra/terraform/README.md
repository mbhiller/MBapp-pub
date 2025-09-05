# Terraform single-apply for MBapp (us-east-1)

Creates:

- S3 bucket for web hosting
- CloudFront distribution in front of the web bucket
- DynamoDB tables (devices, scans)
- Lambda + API Gateway HTTP API

## Quick start

```
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```
