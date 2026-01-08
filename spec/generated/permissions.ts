/**
 * Auto-generated permissions mapping from spec/openapi.yaml.
 * DO NOT EDIT MANUALLY. Regenerate with: npm run spec:permissions
 *
 * Format: "METHOD /path" -> "permission:key"
 * Example: "POST /purchasing/suggest-po" -> "purchase:write"
 */

export const PERMISSIONS_BY_ENDPOINT = {
  "DELETE /views/{id}": "view:write",
  "DELETE /workspaces/{id}": "workspace:write",
  "GET /events/{eventId}:classes-summary": "event:read registration:read",
  "GET /events/{eventId}:registrations-by-line": "event:read registration:read",
  "GET /inventory/{id}/onhand": "inventory:read",
  "GET /inventory/{id}/onhand:by-location": "inventory:read",
  "GET /messages": "message:read",
  "GET /reservation-holds/by-owner": "registration:read",
  "GET /views": "view:read",
  "GET /views/{id}": "view:read",
  "GET /workspaces": "workspace:read",
  "GET /workspaces/{id}": "workspace:read",
  "PATCH /views/{id}": "view:write",
  "PATCH /workspaces/{id}": "workspace:write",
  "POST /internal/jobs:run": "ops:jobs:run",
  "POST /inventory/{id}:cycle-count": "inventory:adjust",
  "POST /inventory/{id}:putaway": "inventory:write",
  "POST /inventory/{id}/adjust": "inventory:write",
  "POST /inventory/onhand:batch": "inventory:read",
  "POST /messages:retry-failed": "message:write",
  "POST /messages/{id}:retry": "message:write",
  "POST /objects/backorderRequest/{id}:convert": "objects:write",
  "POST /objects/backorderRequest/{id}:ignore": "objects:write",
  "POST /objects/party:batch": "party:read",
  "POST /purchasing/po:create-from-suggestion": "purchase:write",
  "POST /purchasing/po/{id}:approve": "purchase:approve",
  "POST /purchasing/po/{id}:cancel": "purchase:cancel",
  "POST /purchasing/po/{id}:close": "purchase:close",
  "POST /purchasing/po/{id}:patch-lines": "purchase:write",
  "POST /purchasing/po/{id}:receive": "purchase:receive",
  "POST /purchasing/suggest-po": "purchase:write",
  "POST /registrations:cleanup-expired-holds": "registration:write",
  "POST /registrations/{id}:assign-resources": "registration:write",
  "POST /registrations/{id}:assign-rv-sites": "registration:write",
  "POST /registrations/{id}:assign-stalls": "registration:write",
  "POST /registrations/{id}:cancel": "registration:write",
  "POST /registrations/{id}:cancel-refund": "registration:write",
  "POST /sales/so/{id}:cancel": "sales:cancel",
  "POST /sales/so/{id}:close": "sales:close",
  "POST /sales/so/{id}:commit": "sales:commit",
  "POST /sales/so/{id}:fulfill": "sales:fulfill",
  "POST /sales/so/{id}:patch-lines": "sales:write",
  "POST /sales/so/{id}:release": "sales:reserve",
  "POST /sales/so/{id}:reserve": "sales:reserve",
  "POST /sales/so/{id}:submit": "sales:write",
  "POST /views": "view:write",
  "POST /workspaces": "workspace:write",
  "PUT /views/{id}": "view:write",
  "PUT /workspaces/{id}": "workspace:write"
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
export const PERM_EVENT_READ_REGISTRATION_READ = "event:read registration:read" as const;
export const PERM_INVENTORY_ADJUST = "inventory:adjust" as const;
export const PERM_INVENTORY_READ = "inventory:read" as const;
export const PERM_INVENTORY_WRITE = "inventory:write" as const;
export const PERM_MESSAGE_READ = "message:read" as const;
export const PERM_MESSAGE_WRITE = "message:write" as const;
export const PERM_OBJECTS_WRITE = "objects:write" as const;
export const PERM_OPS_JOBS_RUN = "ops:jobs:run" as const;
export const PERM_PARTY_READ = "party:read" as const;
export const PERM_PURCHASE_APPROVE = "purchase:approve" as const;
export const PERM_PURCHASE_CANCEL = "purchase:cancel" as const;
export const PERM_PURCHASE_CLOSE = "purchase:close" as const;
export const PERM_PURCHASE_RECEIVE = "purchase:receive" as const;
export const PERM_PURCHASE_WRITE = "purchase:write" as const;
export const PERM_REGISTRATION_READ = "registration:read" as const;
export const PERM_REGISTRATION_WRITE = "registration:write" as const;
export const PERM_SALES_CANCEL = "sales:cancel" as const;
export const PERM_SALES_CLOSE = "sales:close" as const;
export const PERM_SALES_COMMIT = "sales:commit" as const;
export const PERM_SALES_FULFILL = "sales:fulfill" as const;
export const PERM_SALES_RESERVE = "sales:reserve" as const;
export const PERM_SALES_WRITE = "sales:write" as const;
export const PERM_VIEW_READ = "view:read" as const;
export const PERM_VIEW_WRITE = "view:write" as const;
export const PERM_WORKSPACE_READ = "workspace:read" as const;
export const PERM_WORKSPACE_WRITE = "workspace:write" as const;

/**
 * Array of all unique permission keys (sorted).
 */
export const PERMISSION_KEYS = [
  "event:read registration:read",
  "inventory:adjust",
  "inventory:read",
  "inventory:write",
  "message:read",
  "message:write",
  "objects:write",
  "ops:jobs:run",
  "party:read",
  "purchase:approve",
  "purchase:cancel",
  "purchase:close",
  "purchase:receive",
  "purchase:write",
  "registration:read",
  "registration:write",
  "sales:cancel",
  "sales:close",
  "sales:commit",
  "sales:fulfill",
  "sales:reserve",
  "sales:write",
  "view:read",
  "view:write",
  "workspace:read",
  "workspace:write"
] as const;
