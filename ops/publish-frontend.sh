#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export AWS_REGION="${AWS_REGION:-us-east-1}"

API_URL="${1:-}"
CF_DOMAIN="${2:-}"

if [[ -z "${API_URL}" && -d "infra/terraform" ]]; then
  pushd infra/terraform >/dev/null
  API_URL="$(terraform output -raw http_api_url 2>/dev/null || true)"
  popd >/dev/null
fi
if [[ -z "${CF_DOMAIN}" && -d "infra/terraform" ]]; then
  pushd infra/terraform >/dev/null
  CF_DOMAIN="$(terraform output -raw cloudfront_domain 2>/dev/null || true)"
  popd >/dev/null
fi

if [[ -z "${API_URL}" ]]; then
  echo "ERROR: API_URL is required (arg1) or derivable from Terraform outputs." >&2
  exit 1
fi

if [[ -z "${CF_DOMAIN}" ]]; then
  echo "WARN: CF domain not provided; will publish without invalidation."
fi

if [[ -d "infra/terraform" ]]; then
  WEB_BUCKET="$(terraform state show -no-color aws_s3_bucket.web 2>/dev/null | awk -F'\"' '/^ *id *= \"/{print $2; exit}')"
fi
if [[ -z "${WEB_BUCKET:-}" && -n "${CF_DOMAIN}" ]]; then
  DIST_ID="$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='${CF_DOMAIN}'].Id | [0]" --output text)"
  ORIGIN_DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query "Distribution.DistributionConfig.Origins.Items[0].DomainName" --output text)"
  WEB_BUCKET="${ORIGIN_DOMAIN%%.s3*}"
fi
if [[ -z "${WEB_BUCKET:-}" ]]; then
  echo "ERROR: Could not determine web bucket from TF state or CloudFront. Set WEB_BUCKET env var." >&2
  exit 1
fi

echo "window.API_BASE = \"${API_URL%/}\";" > frontend/env.js

aws s3 sync ./frontend "s3://${WEB_BUCKET}" --delete

if [[ -n "${CF_DOMAIN}" ]]; then
  DIST_ID="$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='${CF_DOMAIN}'].Id | [0]" --output text)"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null || true
fi

echo "Published. Open: https://${CF_DOMAIN:-<your-cloudfront-domain>}"
