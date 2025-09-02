#!/usr/bin/env bash
set -Eeuo pipefail
: "${AWS_REGION:=us-east-1}"
export AWS_REGION

INSTANCE_ARN="$(aws sso-admin list-instances --query 'Instances[0].InstanceArn' --output text)"
if [[ -z "${INSTANCE_ARN}" || "${INSTANCE_ARN}" == "None" ]]; then
  echo "ERROR: No Identity Center instance detected in ${AWS_REGION}." >&2
  exit 1
fi

create_ps () {
  local NAME="$1"; local DESC="$2"; local POLICY_ARN="$3"
  local ARN="$(aws sso-admin create-permission-set \
    --instance-arn "${INSTANCE_ARN}" \
    --name "${NAME}" \
    --description "${DESC}" \
    --session-duration "PT8H" \
    --relay-state "https://console.aws.amazon.com/" \
    --query 'PermissionSet.PermissionSetArn' --output text 2>/dev/null || true)"
  if [[ -z "${ARN}" || "${ARN}" == "None" ]]; then
    ARN="$(aws sso-admin list-permission-sets --instance-arn "${INSTANCE_ARN}" \
      --query 'PermissionSets[]' --output text | xargs -n1 -I{} aws sso-admin describe-permission-set --instance-arn "${INSTANCE_ARN}" --permission-set-arn {} \
      --query "PermissionSet[?Name=='${NAME}'].PermissionSetArn | [0]" --output text)"
  fi
  aws sso-admin attach-managed-policy-to-permission-set \
    --instance-arn "${INSTANCE_ARN}" \
    --permission-set-arn "${ARN}" \
    --managed-policy-arn "${POLICY_ARN}" || true
  echo "${NAME}: ${ARN}"
}

create_ps "MBAdmin" "Full admin access for MBapp workloads" "arn:aws:iam::aws:policy/AdministratorAccess"
create_ps "MBReadOnly" "Read-only access for MBapp workloads" "arn:aws:iam::aws:policy/ReadOnlyAccess"

echo "Permission sets are ready. Assign users/groups in the console."
