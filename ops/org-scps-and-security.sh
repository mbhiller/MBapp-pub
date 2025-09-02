#!/usr/bin/env bash
set -Eeuo pipefail
: "${AWS_REGION:=us-east-1}"
export AWS_REGION
: "${OU_NAME_WORKLOADS:?OU_NAME_WORKLOADS must be set}"
: "${CLOUDTRAIL_BUCKET:?CLOUDTRAIL_BUCKET must be set}"

CALLER_ACCT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "${CALLER_ACCT}" != "${MANAGEMENT_ACCOUNT_ID:-}" ]]; then
  echo "ERROR: Run this in the MANAGEMENT account (${MANAGEMENT_ACCOUNT_ID:-unset}), found ${CALLER_ACCT}." >&2
  exit 1
fi

ROOT_ID="$(aws organizations list-roots --query 'Roots[0].Id' --output text)"

EXISTING_OU_ID="$(aws organizations list-organizational-units-for-parent \
  --parent-id "${ROOT_ID}" --query "OrganizationalUnits[?Name=='${OU_NAME_WORKLOADS}'].Id | [0]" --output text)"
if [[ "${EXISTING_OU_ID}" == "None" ]] || [[ -z "${EXISTING_OU_ID}" ]]; then
  OU_ID="$(aws organizations create-organizational-unit --parent-id "${ROOT_ID}" \
    --name "${OU_NAME_WORKLOADS}" --query 'OrganizationalUnit.Id' --output text)"
else
  OU_ID="${EXISTING_OU_ID}"
fi
echo "Workloads OU: ${OU_ID}"

POLICY_NAME="DenyLeaveOrg"
POLICY_DESC="Prevents leaving the AWS Organization"
POLICY_DOC='{"Version":"2012-10-17","Statement":[{"Sid":"DenyLeaveOrg","Effect":"Deny","Action":"organizations:LeaveOrganization","Resource":"*"}]}'
EXISTING_POLICY_ID="$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY \
  --query "Policies[?Name=='${POLICY_NAME}'].Id | [0]" --output text)"
if [[ "${EXISTING_POLICY_ID}" == "None" ]] || [[ -z "${EXISTING_POLICY_ID}" ]]; then
  POLICY_ID="$(aws organizations create-policy \
    --name "${POLICY_NAME}" \
    --type SERVICE_CONTROL_POLICY \
    --content "${POLICY_DOC}" \
    --description "${POLICY_DESC}" \
    --query 'Policy.PolicySummary.Id' --output text)"
else
  POLICY_ID="${EXISTING_POLICY_ID}"
fi
aws organizations attach-policy --policy-id "${POLICY_ID}" --target-id "${OU_ID}" || true

TRAIL_NAME="org-trail"
if ! aws cloudtrail describe-trails --query "trailList[?Name=='${TRAIL_NAME}'].Name | [0]" --output text >/dev/null 2>&1; then
  aws cloudtrail create-trail \
    --name "${TRAIL_NAME}" \
    --s3-bucket-name "${CLOUDTRAIL_BUCKET}" \
    --is-organization-trail \
    --is-multi-region-trail \
    --enable-log-file-validation \
    --query 'Trail.Arn' --output text
else
  aws cloudtrail update-trail \
    --name "${TRAIL_NAME}" \
    --s3-bucket-name "${CLOUDTRAIL_BUCKET}" \
    --is-multi-region-trail \
    --enable-log-file-validation
fi
aws cloudtrail start-logging --name "${TRAIL_NAME}" || true
echo "Org guardrails and CloudTrail configured."
