/**
 * Derive permission map from role strings.
 * Used when JWT has roles but no explicit mbapp.policy claim.
 */
export function derivePolicyFromRoles(roles: string[]): Record<string, boolean> {
  const policy: Record<string, boolean> = {};

  for (const role of roles) {
    const normalized = role.toLowerCase().trim();
    
    switch (normalized) {
      case "admin":
        // Superuser: all permissions
        policy["*"] = true;
        break;

      case "operator":
        // Common operator permissions: read all, write sales/purchase/inventory
        policy["*:read"] = true;
        policy["sales:*"] = true;
        policy["purchase:*"] = true;
        policy["inventory:*"] = true;
        policy["view:*"] = true;
        policy["workspace:*"] = true;
        policy["scanner:use"] = true;
        break;

      case "viewer":
        // Read-only access to all modules
        policy["*:read"] = true;
        break;

      case "warehouse":
        // Warehouse staff: read all, full inventory control, receive POs
        policy["*:read"] = true;
        policy["inventory:*"] = true;
        policy["purchase:receive"] = true;
        policy["scanner:use"] = true;
        break;

      default:
        // Unknown roles grant no permissions
        break;
    }
  }

  return policy;
}
