#!/usr/bin/env bash
set -Eeuo pipefail
: "${AWS_REGION:=us-east-1}"; export AWS_REGION

if [[ -f "./ops/org-accounts.env" ]]; then
  set -a; . ./ops/org-accounts.env; set +a
fi

TENANTS_API_BASE="${TENANTS_API_BASE:-https://example.com/tenants}"
GITHUB_ORG="${GITHUB_ORG:-}"
GITHUB_REPO="${GITHUB_REPO:-}"

echo "TENANTS_API_BASE=${TENANTS_API_BASE}" > .app.env
echo "AWS_REGION=${AWS_REGION}" >> .app.env

node -v || true
npm -v || true
terraform -version || true

if command -v gh >/dev/null 2>&1 && [[ -n "${GITHUB_ORG}" && -n "${GITHUB_REPO}" ]]; then
  gh repo view "${GITHUB_ORG}/${GITHUB_REPO}" >/dev/null 2>&1 || gh repo create "${GITHUB_ORG}/${GITHUB_REPO}" --private --confirm
  git init
  git add .
  git commit -m "MBapp bootstrap"
  git branch -M main
  git remote add origin "https://github.com/${GITHUB_ORG}/${GITHUB_REPO}.git" || true
  git push -u origin main || true
fi

echo "CloudShell bootstrap complete."
