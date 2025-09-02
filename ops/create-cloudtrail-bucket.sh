#!/usr/bin/env bash
set -Eeuo pipefail
: "${AWS_REGION:=us-east-1}"
export AWS_REGION
: "${CLOUDTRAIL_BUCKET:?CLOUDTRAIL_BUCKET must be set}"

echo "Creating S3 bucket: ${CLOUDTRAIL_BUCKET} (${AWS_REGION})"
if [[ "${AWS_REGION}" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "${CLOUDTRAIL_BUCKET}" 2>/dev/null || true
else
  aws s3api create-bucket --bucket "${CLOUDTRAIL_BUCKET}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}" 2>/dev/null || true
fi

aws s3api put-bucket-versioning --bucket "${CLOUDTRAIL_BUCKET}" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "${CLOUDTRAIL_BUCKET}" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "${CLOUDTRAIL_BUCKET}" --public-access-block-configuration '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}'

ORG_ID="$(aws organizations describe-organization --query 'Organization.Id' --output text 2>/dev/null || true)"
if [[ -n "${ORG_ID}" && "${ORG_ID}" != "None" ]]; then
  cat > /tmp/bucket-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudTrailAclCheck",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws:s3:::${CLOUDTRAIL_BUCKET}",
      "Condition": {"StringEquals": {"aws:PrincipalOrgID": "${ORG_ID}"}}
    },
    {
      "Sid": "CloudTrailWrite",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::${CLOUDTRAIL_BUCKET}/AWSLogs/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": "bucket-owner-full-control",
          "aws:PrincipalOrgID": "${ORG_ID}"
        }
      }
    }
  ]
}
POLICY
else
  cat > /tmp/bucket-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudTrailAclCheck",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws:s3:::${CLOUDTRAIL_BUCKET}"
    },
    {
      "Sid": "CloudTrailWrite",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::${CLOUDTRAIL_BUCKET}/AWSLogs/*",
      "Condition": {"StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control"}}
    }
  ]
}
POLICY
fi

aws s3api put-bucket-policy --bucket "${CLOUDTRAIL_BUCKET}" --policy file:///tmp/bucket-policy.json
echo "Bucket ready."
