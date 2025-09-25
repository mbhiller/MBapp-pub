# 0001 — Policy Blob for RBAC
**Status:** Accepted — 2025-09-23

## Context
Clients need a compact, cacheable way to know which actions/Views/Workspaces to surface; server must still enforce.

## Decision
Expose `GET /auth/policy` returning:
- `user, tenants, roles, permissions, scopes, version, issuedAt`
Server enforces via middleware `requirePerm`.

## Consequences
- Easy to add roles/permissions without client rewrites
- Future Cognito swap keeps the same contract
