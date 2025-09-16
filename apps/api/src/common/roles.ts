// apps/api/src/common/roles.ts

// Keep the union open-ended so you can grow it alongside MBapp-Combined.md
export type Role =
  | "admin"
  | "manager"
  | "staff"
  | "volunteer"
  | "viewer"
  | (string & {}); // allow custom roles (future-proof)

/** Parse roles from headers (comma-separated), e.g. x-roles: "admin, staff" */
export function getUserRoles(evt: { headers?: Record<string, string | undefined> }): Role[] {
  const h = evt.headers || {};
  const raw = h["x-roles"] ?? h["X-Roles"] ?? h["x-user-roles"] ?? "";
  return String(raw)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean) as Role[];
}

/** Simple utility: do any of the required roles appear in the user's roles? */
export function hasRole(userRoles: Role[], required: Role | Role[]): boolean {
  const req = Array.isArray(required) ? required : [required];
  return req.some(r => userRoles.includes(r));
}

/**
 * Placeholder allow-all gate.
 * Wire this into handlers when you're ready to enforce:
 *   if (!isAllowed(evt, "objects", "update", type)) return forbidden("not allowed");
 */
export function isAllowed(
  _evt: any,
  _resource: string,
  _action: "create" | "read" | "update" | "delete" | string,
  _type?: string
): boolean {
  return true; // enforcement off by default (non-breaking)
}
