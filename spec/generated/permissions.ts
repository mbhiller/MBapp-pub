/**
 * Auto-generated permissions mapping from spec/openapi.yaml.
 * DO NOT EDIT MANUALLY. Regenerate with: npm run spec:permissions
 *
 * Format: "METHOD /path" -> "permission:key"
 * Example: "POST /purchasing/suggest-po" -> "purchase:write"
 */

export const PERMISSIONS_BY_ENDPOINT = {
  "POST /objects/backorderRequest/{id}:convert": "objects:write",
  "POST /objects/backorderRequest/{id}:ignore": "objects:write",
  "POST /purchasing/po:create-from-suggestion": "purchase:write",
  "POST /purchasing/po/{id}:approve": "purchase:approve",
  "POST /purchasing/po/{id}:cancel": "purchase:cancel",
  "POST /purchasing/po/{id}:close": "purchase:close",
  "POST /purchasing/po/{id}:receive": "purchase:receive",
  "POST /purchasing/suggest-po": "purchase:write"
} as const;

/**
 * Reverse mapping for convenience: permission -> endpoints
 */
export const ENDPOINTS_BY_PERMISSION = Object.entries(
  PERMISSIONS_BY_ENDPOINT
).reduce<Record<string, string[]>>((acc, [endpoint, perm]) => {
  if (!acc[perm]) {
    acc[perm] = [];
  }
  acc[perm].push(endpoint);
  return acc;
}, {});

// Export types for stricter TypeScript usage
export type PermissionKey = typeof PERMISSIONS_BY_ENDPOINT[keyof typeof PERMISSIONS_BY_ENDPOINT];
export type EndpointKey = keyof typeof PERMISSIONS_BY_ENDPOINT;

/**
 * Ergonomic permission alias constants.
 * Use these for cleaner permission checks in UI code.
 * Example: hasPerm(policy, PERM_OBJECTS_WRITE)
 */
export const PERM_OBJECTS_WRITE = "objects:write" as const;
export const PERM_PURCHASE_APPROVE = "purchase:approve" as const;
export const PERM_PURCHASE_CANCEL = "purchase:cancel" as const;
export const PERM_PURCHASE_CLOSE = "purchase:close" as const;
export const PERM_PURCHASE_RECEIVE = "purchase:receive" as const;
export const PERM_PURCHASE_WRITE = "purchase:write" as const;

/**
 * Array of all unique permission keys (sorted).
 */
export const PERMISSION_KEYS = [
  "objects:write",
  "purchase:approve",
  "purchase:cancel",
  "purchase:close",
  "purchase:receive",
  "purchase:write"
] as const;
